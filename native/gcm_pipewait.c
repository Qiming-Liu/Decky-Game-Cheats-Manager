/*
 * Helps FLiNG trainers run under FEX on ARM. The starter loads this library
 * into a 64-bit program that imports WaitNamedPipeW; it changes only that
 * program's own imports, in memory.
 *
 * Pipe waits: FLiNG trainers start their window as a separate .NET part and
 * wait for it with WaitNamedPipeW, 10 ms at a time, a fixed number of times
 * (about 11 seconds in all). Where the window starts slowly, as under FEX,
 * the trainer gives up and exits before the window ever shows. A short wait
 * that finds no pipe now keeps waiting, up to SCALE times as long, and
 * returns as soon as the pipe is there.
 *
 * Code writes: FEX keeps game code it has translated read-only, so a cheat
 * that patches code fails with ERROR_NOACCESS and the trainer reports a
 * memory write error. A write that fails on a page that is not writable now
 * makes that range writable, writes again and flushes the instruction cache,
 * so FEX translates the new code. Trainers look the write functions up with
 * GetProcAddress at run time, so that import is replaced too. A write that
 * succeeds the first time, as everywhere but under FEX, is not changed.
 *
 * Code caves: a 64-bit cheat jumps from the game's code to its own, which
 * has to sit within 2 GB of it. The trainer asks for memory one page after
 * another, starting at the code, until an address is free. FEX reserves most
 * of that space for itself, unseen by Wine, so each of up to half a million
 * requests fails and the trainer stays "initializing" for many minutes. Once
 * a second request in such a row fails, the search is done here in far fewer
 * steps and the trainer gets the address found.
 *
 * Process rights: Wine tells the emulator in the game about memory another
 * process allocates, protects or writes there, and to reach it needs the
 * right to copy the game's handles. Trainers open the game without it, so
 * FEX never hears of a new cave, refuses to run it, and the game crashes on
 * its first jump into one. The game is opened with that right as well.
 *
 * Nothing else is touched. A program with none of these imports gets nothing
 * patched, and the library unloads.
 */
#include <windows.h>
#include <string.h>

#define SCALE 20
#define SHORT_WAIT_MS 1000
#define WRITABLE (PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)
/* Rights with which a program changes another one's memory. */
#define MEMORY_RIGHTS (PROCESS_VM_OPERATION | PROCESS_VM_WRITE)
/* How far a jump with a 32-bit offset reaches, less a margin for the cave itself. */
#define NEAR_REACH 0x7FF00000ull
/* Requests this close to the one before belong to the same search. */
#define SEARCH_STEP 0x10000
#define GRANULARITY 0x10000ull
#define MEGABYTE 0x100000ull
/* Addresses tried at each end of a region Wine has free, and regions looked at. */
#define EDGE_SLOTS 4
#define REGION_LIMIT 4096

typedef BOOL(WINAPI *wait_named_pipe)(LPCWSTR, DWORD);
typedef LPVOID(WINAPI *virtual_alloc_ex)(HANDLE, LPVOID, SIZE_T, DWORD, DWORD);
typedef HANDLE(WINAPI *open_process)(DWORD, BOOL, DWORD);
typedef FARPROC(WINAPI *get_proc_address)(HMODULE, LPCSTR);
typedef BOOL(WINAPI *write_process_memory)(HANDLE, LPVOID, LPCVOID, SIZE_T, SIZE_T *);
typedef LONG(NTAPI *nt_write_virtual_memory)(HANDLE, PVOID, const void *, SIZE_T, SIZE_T *);

static wait_named_pipe original_wait;
static get_proc_address original_lookup;
static write_process_memory original_write;
static nt_write_virtual_memory original_nt_write;
static virtual_alloc_ex original_alloc;
static open_process original_open;

/* The trainer's current page-by-page search for free memory near some code. */
static SRWLOCK search_lock = SRWLOCK_INIT;
static HANDLE search_process;
static ULONG_PTR search_start, search_last;
static BOOL search_failed;


static BOOL WINAPI patient_wait(LPCWSTR name, DWORD timeout)
{
    if (timeout == 0 || timeout > SHORT_WAIT_MS) return original_wait(name, timeout);
    ULONGLONG deadline = GetTickCount64() + (ULONGLONG)timeout * SCALE;
    for (;;) {
        if (original_wait(name, timeout)) return TRUE;
        DWORD error = GetLastError();
        /* No pipe yet (2) or the wait timed out (121): try again until the longer deadline. */
        if ((error != ERROR_FILE_NOT_FOUND && error != ERROR_SEM_TIMEOUT) || GetTickCount64() >= deadline) {
            SetLastError(error);
            return FALSE;
        }
        /* A missing pipe can fail at once; keep the pace of the original wait. */
        Sleep(timeout);
    }
}

/* Makes a range of another process writable when it is not; FALSE when it was already writable or that failed. */
static BOOL make_writable(HANDLE process, LPVOID address, SIZE_T size)
{
    MEMORY_BASIC_INFORMATION info;
    if (!VirtualQueryEx(process, address, &info, sizeof(info)) || info.State != MEM_COMMIT) return FALSE;
    if (info.Protect & WRITABLE) return FALSE;
    DWORD previous;
    return VirtualProtectEx(process, address, size, PAGE_EXECUTE_READWRITE, &previous);
}

static BOOL WINAPI unlocking_write(HANDLE process, LPVOID address, LPCVOID buffer, SIZE_T size, SIZE_T *written)
{
    if (original_write(process, address, buffer, size, written)) return TRUE;
    DWORD error = GetLastError();
    if (error != ERROR_NOACCESS || !make_writable(process, address, size)) {
        SetLastError(error);
        return FALSE;
    }
    if (!original_write(process, address, buffer, size, written)) return FALSE;
    FlushInstructionCache(process, address, size);
    return TRUE;
}

static LONG NTAPI unlocking_nt_write(HANDLE process, PVOID address, const void *buffer, SIZE_T size, SIZE_T *written)
{
    LONG status = original_nt_write(process, address, buffer, size, written);
    if (status >= 0 || !make_writable(process, address, size)) return status;
    status = original_nt_write(process, address, buffer, size, written);
    if (status >= 0) FlushInstructionCache(process, address, size);
    return status;
}

/*
 * Opens another process with the right to copy its handles as well, when its memory is going to be changed.
 * Wine needs that right to reach the emulator in the other process; without it FEX never hears of the change.
 */
static HANDLE WINAPI notifying_open(DWORD access, BOOL inherit, DWORD pid)
{
    if ((access & MEMORY_RIGHTS) && !(access & PROCESS_DUP_HANDLE)) {
        HANDLE process = original_open(access | PROCESS_DUP_HANDLE, inherit, pid);
        if (process) return process;
    }
    return original_open(access, inherit, pid);
}

/* One request of the search, at an address within reach of where it started; NULL when that is taken or too far. */
static LPVOID try_near(HANDLE process, ULONG_PTR candidate, SIZE_T size, DWORD type, DWORD protect)
{
    ULONG_PTR distance = candidate > search_start ? candidate + size - search_start : search_start - candidate;
    if (distance >= NEAR_REACH) {
        SetLastError(ERROR_INVALID_ADDRESS);
        return NULL;
    }
    return original_alloc(process, (LPVOID)candidate, size, type, protect);
}

/*
 * Looks for free memory beyond `wanted`, up or down as the trainer was going, no further than a jump reaches
 * from where its search started. First every megabyte, which finds a large gap in a second or two; then the
 * ends of the regions Wine has free, where the gaps between the game's own libraries are; then every address
 * that can be reserved at all.
 */
static LPVOID search_near(HANDLE process, ULONG_PTR wanted, BOOL upward, SIZE_T size, DWORD type, DWORD protect)
{
    LPVOID found;
    for (ULONG_PTR distance = MEGABYTE; distance < NEAR_REACH && (upward || distance <= wanted); distance += MEGABYTE) {
        ULONG_PTR candidate = (upward ? wanted + distance : wanted - distance) & ~(MEGABYTE - 1);
        if ((found = try_near(process, candidate, size, type, protect))) return found;
        if (GetLastError() != ERROR_INVALID_ADDRESS) return NULL;
    }
    ULONG_PTR cursor = wanted;
    for (int regions = 0; regions < REGION_LIMIT; regions++) {
        MEMORY_BASIC_INFORMATION info;
        if (!upward && !cursor) break;
        if (!VirtualQueryEx(process, (LPCVOID)(upward ? cursor : cursor - 1), &info, sizeof(info))) break;
        ULONG_PTR base = (ULONG_PTR)info.BaseAddress, end = base + info.RegionSize;
        if (info.State == MEM_FREE && end - base >= GRANULARITY) {
            ULONG_PTR low = (base + GRANULARITY - 1) & ~(GRANULARITY - 1), high = (end - size) & ~(GRANULARITY - 1);
            for (int slot = 0; slot < EDGE_SLOTS; slot++) {
                ULONG_PTR offset = slot * GRANULARITY;
                if (low + offset <= high && (found = try_near(process, low + offset, size, type, protect))) return found;
                if (high >= low + offset && (found = try_near(process, high - offset, size, type, protect))) return found;
            }
        }
        if ((upward ? end - search_start : search_start - base) >= NEAR_REACH || end <= base) break;
        cursor = upward ? end : base;
    }
    for (ULONG_PTR distance = GRANULARITY; distance < NEAR_REACH && (upward || distance <= wanted); distance += GRANULARITY) {
        ULONG_PTR candidate = (upward ? wanted + distance : wanted - distance) & ~(GRANULARITY - 1);
        if ((found = try_near(process, candidate, size, type, protect))) return found;
        if (GetLastError() != ERROR_INVALID_ADDRESS) return NULL;
    }
    return NULL;
}

static LPVOID WINAPI near_alloc(HANDLE process, LPVOID address, SIZE_T size, DWORD type, DWORD protect)
{
    LPVOID memory = original_alloc(process, address, size, type, protect);
    DWORD error = GetLastError();
    if (memory || !address || !(type & MEM_RESERVE) || error != ERROR_INVALID_ADDRESS) {
        SetLastError(error);
        return memory;
    }
    /* The address is taken. A request a step from the last one that failed continues that search. */
    ULONG_PTR wanted = (ULONG_PTR)address;
    AcquireSRWLockExclusive(&search_lock);
    BOOL upward = wanted > search_last;
    ULONG_PTR step = upward ? wanted - search_last : search_last - wanted;
    BOOL continues = process == search_process && step && step <= SEARCH_STEP;
    search_process = process;
    search_last = wanted;
    if (!continues) {
        search_start = wanted;
        search_failed = FALSE;
    } else if (!search_failed) {
        memory = search_near(process, wanted, upward, size, type, protect);
        /* Found: the search is over. Not found: let the trainer finish its own without repeating this one. */
        if (memory) search_process = NULL;
        else search_failed = TRUE;
    }
    ReleaseSRWLockExclusive(&search_lock);
    SetLastError(memory ? ERROR_SUCCESS : error);
    return memory;
}

/* Hands out this library's functions in place of the real ones; every other lookup is unchanged. */
static FARPROC WINAPI lookup(HMODULE module, LPCSTR name)
{
    FARPROC found = original_lookup(module, name);
    if (!found || (ULONG_PTR)name < 0x10000) return found;
    if (!strcmp(name, "OpenProcess")) {
        original_open = (open_process)(void (*)(void))found;
        return (FARPROC)(void (*)(void))notifying_open;
    }
    if (!strcmp(name, "VirtualAllocEx")) {
        original_alloc = (virtual_alloc_ex)(void (*)(void))found;
        return (FARPROC)(void (*)(void))near_alloc;
    }
    if (!strcmp(name, "WriteProcessMemory")) {
        original_write = (write_process_memory)(void (*)(void))found;
        return (FARPROC)(void (*)(void))unlocking_write;
    }
    if (!strcmp(name, "NtWriteVirtualMemory")) {
        original_nt_write = (nt_write_virtual_memory)(void (*)(void))found;
        return (FARPROC)(void (*)(void))unlocking_nt_write;
    }
    return found;
}

/* Points the module's imports of a function at a replacement and keeps the first original; returns how many. */
static int patch_imports(HMODULE module, const char *function, void *replacement, void **original)
{
    BYTE *base = (BYTE *)module;
    IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + ((IMAGE_DOS_HEADER *)base)->e_lfanew);
    IMAGE_DATA_DIRECTORY imports = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    if (!imports.VirtualAddress) return 0;
    int patched = 0;
    for (IMAGE_IMPORT_DESCRIPTOR *entry = (IMAGE_IMPORT_DESCRIPTOR *)(base + imports.VirtualAddress); entry->Name; entry++) {
        if (!entry->OriginalFirstThunk) continue;
        IMAGE_THUNK_DATA *names = (IMAGE_THUNK_DATA *)(base + entry->OriginalFirstThunk);
        IMAGE_THUNK_DATA *slots = (IMAGE_THUNK_DATA *)(base + entry->FirstThunk);
        for (; names->u1.AddressOfData; names++, slots++) {
            if (IMAGE_SNAP_BY_ORDINAL(names->u1.Ordinal)) continue;
            IMAGE_IMPORT_BY_NAME *import = (IMAGE_IMPORT_BY_NAME *)(base + names->u1.AddressOfData);
            if (strcmp((const char *)import->Name, function) != 0) continue;
            DWORD protection;
            if (!VirtualProtect(&slots->u1.Function, sizeof(slots->u1.Function), PAGE_READWRITE, &protection)) continue;
            if (!*original) *original = (void *)(ULONG_PTR)slots->u1.Function;
            slots->u1.Function = (ULONG_PTR)replacement;
            VirtualProtect(&slots->u1.Function, sizeof(slots->u1.Function), protection, &protection);
            patched++;
        }
    }
    return patched;
}

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved)
{
    (void)self;
    (void)reserved;
    if (reason != DLL_PROCESS_ATTACH) return TRUE;
    HMODULE program = GetModuleHandleW(NULL);
    int patched = patch_imports(program, "WaitNamedPipeW", (void *)patient_wait, (void **)&original_wait);
    patched += patch_imports(program, "GetProcAddress", (void *)lookup, (void **)&original_lookup);
    patched += patch_imports(program, "WriteProcessMemory", (void *)unlocking_write, (void **)&original_write);
    patched += patch_imports(program, "VirtualAllocEx", (void *)near_alloc, (void **)&original_alloc);
    patched += patch_imports(program, "OpenProcess", (void *)notifying_open, (void **)&original_open);
    /* Failing the attach unloads the library: the starter logs that nothing was patched. */
    return patched > 0;
}
