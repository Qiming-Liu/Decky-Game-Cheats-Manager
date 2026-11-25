/*
 * Starts one trainer program and marks it a Wine system process.
 *
 * Proton's steam.exe treats the game as finished only when every non-system
 * Wine process in the prefix has exited, so a trainer left open keeps the game
 * "running" in Steam. A system process does not count: once the game exits,
 * steam.exe returns and wineserver closes the trainer during its shutdown.
 * On Windows, or a Wine without this call, the program still starts normally.
 *
 * Every start is recorded in .gcm-launch.log beside this program (UTF-8), which
 * the plugin copies into its own log. A detached copy of the starter then
 * follows the program, so the next program on the launcher's list starts at
 * once: whether it opened a window within WATCH_SECONDS, every message box it
 * shows later (title and text) and how it exited. Those go to .gcm-events.log
 * as well, one tab-separated line each, which the plugin shows while the game
 * runs: a trainer that reports an error in a box behind the game, or quits,
 * is not left to fail unseen.
 *
 * A 64-bit program that imports WaitNamedPipeW also gets .gcm-pipewait.dll
 * (beside this program) loaded. It lengthens short pipe waits, without which
 * FLiNG trainers give up on their own window where it starts slowly. For
 * FEX on ARM it also retries code writes that read-only code pages refuse,
 * opens the game so that FEX hears of the memory a cheat allocates, and
 * finds free memory near the game's code in far fewer steps.
 *
 * Some trainers must be running before the game starts (FLiNG's own message:
 * "This trainer needs to launch before the game"): they hook the game while it
 * starts up. Proton starts the game a few seconds after this program, before
 * such a trainer is ready, so for one whose file holds that text the watcher
 * suspends Proton's steam.exe and anything it starts until the trainer shows
 * its window and a few seconds more. The game then starts once the trainer
 * already waits for it.
 *
 * A second argument is passed on to the program: the table Cheat Engine opens.
 * With --ce on ARM64 Wine, its 64-bit executable starts suspended so the
 * compact-context adapter can load before Pascal initializes. --ce-i386 starts
 * the 32-bit build beside the Cheat Engine of the last --ce, with its table (a
 * 32-bit game, see decky_gcm.lua); that build starts as is.
 *
 * Usage: gcm-start.exe "C:\path\to\trainer.exe" ["C:\path\to\table.ct"]
 *        gcm-start.exe --ce "C:\path\to\Cheat Engine.exe" ["C:\path\to\table.ct"]
 *        gcm-start.exe --ce-i386                              (run by the bridge)
 *        gcm-start.exe --watch PID "C:\path\to\trainer.exe"   (started by itself)
 * Exit code: 0 when the program started, 1 otherwise.
 */
#include <windows.h>
#include <psapi.h>
#include <shellapi.h>
#include <stdarg.h>
#include <stdio.h>
#include <tlhelp32.h>
#include <wchar.h>

#define PROCESS_WINE_MAKE_PROCESS_SYSTEM 1000
#define LOG_NAME L".gcm-launch.log"
#define EVENTS_NAME L".gcm-events.log"
#define PIPE_WAIT_NAME L".gcm-pipewait.dll"
#define CE_CONTEXT_NAME L".gcm-ce-context.dll"
#define CE_PATH_VARIABLE L"GCM_CE_PATH"
#define CE_TABLE_VARIABLE L"GCM_CE_TABLE"
#define HOOK_ATTEMPTS 5
/* The plugin empties the log after reading it; this only bounds a log nobody reads. */
#define LOG_LIMIT (256 * 1024)
#define WATCH_SECONDS 30
/* A message box has a few controls; a dialog-based trainer window has many. */
#define DIALOG_MAX_CONTROLS 8
#define DIALOG_TEXT 1024
#define DIALOGS_REMEMBERED 64
/* A clean exit this soon is a hand-off to the programs it started. */
#define HAND_OFF_SECONDS 5
/* Text in a trainer that must start before its game (UTF-16 in FLiNG trainers). */
#define HOLD_TEXT L"needs to launch before the game"
/* How long the game stays held once the trainer shows its window, and at most. */
#define HOLD_GRACE_MS 5000
#define HOLD_LIMIT_MS 60000
#define HOLD_POLL_MS 20
#define HELD_MAX 16

typedef LONG(NTAPI *set_information_process)(HANDLE, ULONG, PVOID, ULONG);
typedef LONG(NTAPI *process_call)(HANDLE);
typedef BOOL(WINAPI *is_wow64_process2)(HANDLE, USHORT *, USHORT *);

static WCHAR log_path[MAX_PATH + 32];
static WCHAR events_path[MAX_PATH + 32];

/* `path` becomes the file `name` beside this program, or empty. */
static void beside_self(WCHAR *path, const WCHAR *name)
{
    DWORD length = GetModuleFileNameW(NULL, path, MAX_PATH);
    if (!length || length >= MAX_PATH) {
        path[0] = 0;
        return;
    }
    WCHAR *file = path + length;
    while (file > path && file[-1] != L'\\' && file[-1] != L'/') file--;
    lstrcpyW(file, name);
}

static void init_log(void)
{
    beside_self(log_path, LOG_NAME);
    beside_self(events_path, EVENTS_NAME);
}

/* Appends UTF-16 text as UTF-8; a file over LOG_LIMIT starts again. Failures are ignored. */
static void append(const WCHAR *path, const WCHAR *text, int used)
{
    if (!path[0] || used <= 0) return;
    int size = WideCharToMultiByte(CP_UTF8, 0, text, used, NULL, 0, NULL, NULL);
    if (size <= 0) return;
    char *bytes = HeapAlloc(GetProcessHeap(), 0, size);
    if (!bytes) return;
    WideCharToMultiByte(CP_UTF8, 0, text, used, bytes, size, NULL, NULL);
    HANDLE file = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                              OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file != INVALID_HANDLE_VALUE) {
        LARGE_INTEGER length;
        if (GetFileSizeEx(file, &length) && length.QuadPart > LOG_LIMIT) {
            CloseHandle(file);
            file = CreateFileW(path, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                               CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        }
    }
    if (file != INVALID_HANDLE_VALUE) {
        DWORD written;
        WriteFile(file, bytes, (DWORD)size, &written, NULL);
        CloseHandle(file);
    }
    HeapFree(GetProcessHeap(), 0, bytes);
}

/* Appends one line, prefixed with the local time. */
static void log_line(const WCHAR *format, ...)
{
    WCHAR text[2048];
    SYSTEMTIME now;
    GetLocalTime(&now);
    int used = _snwprintf(text, 64, L"%04u-%02u-%02u %02u:%02u:%02u starter: ", now.wYear, now.wMonth,
                          now.wDay, now.wHour, now.wMinute, now.wSecond);
    if (used < 0) return;
    va_list args;
    va_start(args, format);
    int added = _vsnwprintf(text + used, ARRAYSIZE(text) - used - 2, format, args);
    va_end(args);
    used = added < 0 ? (int)ARRAYSIZE(text) - 3 : used + added;
    text[used++] = L'\n';
    text[used] = 0;
    append(log_path, text, used);
}

/*
 * Appends one event line: Unix time, pid, kind, program file name and text,
 * separated by tabs. Backslashes, tabs and line breaks in the text are written
 * as \\, \t and \n, so one line is one event.
 */
static void event(const WCHAR *kind, DWORD pid, const WCHAR *program, const WCHAR *format, ...)
{
    WCHAR detail[DIALOG_TEXT + 256];
    va_list args;
    va_start(args, format);
    int length = _vsnwprintf(detail, ARRAYSIZE(detail) - 1, format, args);
    va_end(args);
    if (length < 0) length = ARRAYSIZE(detail) - 1;
    detail[length] = 0;

    FILETIME now;
    GetSystemTimeAsFileTime(&now);
    ULONGLONG ticks = ((ULONGLONG)now.dwHighDateTime << 32) | now.dwLowDateTime;
    WCHAR text[ARRAYSIZE(detail) * 2 + MAX_PATH + 64];
    int used = _snwprintf(text, 64 + MAX_PATH, L"%llu\t%lu\t%ls\t%ls\t", (ticks - 116444736000000000ULL) / 10000000ULL,
                          pid, kind, program);
    if (used < 0) return;
    for (const WCHAR *c = detail; *c && used < (int)ARRAYSIZE(text) - 3; c++) {
        if (*c == L'\r') continue;
        if (*c == L'\\' || *c == L'\t' || *c == L'\n') {
            text[used++] = L'\\';
            text[used++] = *c == L'\t' ? L't' : *c == L'\n' ? L'n' : L'\\';
        } else {
            text[used++] = *c;
        }
    }
    text[used++] = L'\n';
    text[used] = 0;
    append(events_path, text, used);
}

static LONG make_system(HANDLE process)
{
    set_information_process set = (set_information_process)(void (*)(void))GetProcAddress(
        GetModuleHandleW(L"ntdll.dll"), "NtSetInformationProcess");
    if (!set) return -1;
    HANDLE shutdown_event = NULL;
    LONG status = set(process, PROCESS_WINE_MAKE_PROCESS_SYSTEM, &shutdown_event, sizeof(shutdown_event));
    if (status == 0 && shutdown_event) CloseHandle(shutdown_event);
    return status;
}

static const WCHAR *machine_name(USHORT machine)
{
    switch (machine) {
    case IMAGE_FILE_MACHINE_UNKNOWN: return L"native";
    case IMAGE_FILE_MACHINE_I386: return L"x86";
    case IMAGE_FILE_MACHINE_AMD64: return L"x64";
    case 0xAA64: return L"arm64";
    default: return L"other";
    }
}

/* The program's architecture and the system's, as Wine reports them. */
static void log_machine(HANDLE process, DWORD pid)
{
    is_wow64_process2 query = (is_wow64_process2)(void (*)(void))GetProcAddress(
        GetModuleHandleW(L"kernel32.dll"), "IsWow64Process2");
    USHORT own = 0, native = 0;
    if (query && query(process, &own, &native))
        log_line(L"pid %lu runs as %ls on %ls", pid, machine_name(own), machine_name(native));
}

static const WCHAR *file_name(const WCHAR *path)
{
    const WCHAR *name = path + lstrlenW(path);
    while (name > path && name[-1] != L'\\' && name[-1] != L'/') name--;
    return name;
}

/* Reads `size` bytes at file offset `offset`; FALSE when the file is shorter. */
static BOOL read_at(HANDLE file, DWORD offset, void *buffer, DWORD size)
{
    OVERLAPPED at;
    ZeroMemory(&at, sizeof(at));
    at.Offset = offset;
    DWORD read = 0;
    return ReadFile(file, buffer, size, &read, &at) && read == size;
}

/* File offset of an address in the loaded image, or 0 outside every section. */
static DWORD file_offset(const IMAGE_SECTION_HEADER *sections, WORD count, DWORD rva)
{
    for (WORD i = 0; i < count; i++) {
        DWORD size = max(sections[i].Misc.VirtualSize, sections[i].SizeOfRawData);
        if (rva >= sections[i].VirtualAddress && rva - sections[i].VirtualAddress < size)
            return rva - sections[i].VirtualAddress + sections[i].PointerToRawData;
    }
    return 0;
}

/* True for a 64-bit program whose own imports name WaitNamedPipeW. */
static BOOL waits_for_pipes(const WCHAR *path)
{
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, 0, NULL);
    if (file == INVALID_HANDLE_VALUE) return FALSE;
    BOOL found = FALSE;
    IMAGE_DOS_HEADER dos;
    IMAGE_NT_HEADERS64 nt;
    if (!read_at(file, 0, &dos, sizeof(dos)) || dos.e_magic != IMAGE_DOS_SIGNATURE
        || !read_at(file, dos.e_lfanew, &nt, sizeof(nt)) || nt.Signature != IMAGE_NT_SIGNATURE
        || nt.FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 || nt.OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC)
        goto done;
    WORD count = nt.FileHeader.NumberOfSections;
    if (count == 0 || count > 96) goto done;
    IMAGE_SECTION_HEADER sections[96];
    DWORD table = dos.e_lfanew + FIELD_OFFSET(IMAGE_NT_HEADERS64, OptionalHeader) + nt.FileHeader.SizeOfOptionalHeader;
    if (!read_at(file, table, sections, count * sizeof(IMAGE_SECTION_HEADER))) goto done;
    DWORD imports = file_offset(sections, count, nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress);
    for (DWORD entry_index = 0; imports && entry_index < 256 && !found; entry_index++) {
        IMAGE_IMPORT_DESCRIPTOR entry;
        if (!read_at(file, imports + entry_index * sizeof(entry), &entry, sizeof(entry)) || !entry.Name) break;
        DWORD thunks = file_offset(sections, count, entry.OriginalFirstThunk ? entry.OriginalFirstThunk : entry.FirstThunk);
        for (DWORD index = 0; thunks && index < 4096 && !found; index++) {
            ULONGLONG thunk;
            if (!read_at(file, thunks + index * sizeof(thunk), &thunk, sizeof(thunk)) || !thunk) break;
            if (thunk & IMAGE_ORDINAL_FLAG64) continue;
            /* An import by name: a 2-byte hint, then the name. */
            char name[sizeof("WaitNamedPipeW")];
            DWORD at = file_offset(sections, count, (DWORD)thunk);
            found = at && read_at(file, at + 2, name, sizeof(name)) && memcmp(name, "WaitNamedPipeW", sizeof(name)) == 0;
        }
    }
done:
    CloseHandle(file);
    return found;
}

static BOOL has_module(HANDLE process, const WCHAR *path)
{
    HMODULE modules[512];
    DWORD needed = 0;
    if (!K32EnumProcessModulesEx(process, modules, sizeof(modules), &needed, LIST_MODULES_ALL)) return FALSE;
    for (DWORD i = 0; i < needed / sizeof(HMODULE) && i < ARRAYSIZE(modules); i++) {
        WCHAR name[MAX_PATH];
        if (K32GetModuleFileNameExW(process, modules[i], name, MAX_PATH) && lstrcmpiW(name, path) == 0) return TRUE;
    }
    return FALSE;
}

static BOOL arm64_wine(void)
{
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!GetProcAddress(ntdll, "wine_get_version")) return FALSE;
    is_wow64_process2 query = (is_wow64_process2)(void (*)(void))GetProcAddress(
        GetModuleHandleW(L"kernel32.dll"), "IsWow64Process2");
    USHORT own = 0, native = 0;
    return query && query(GetCurrentProcess(), &own, &native) && native == 0xaa64;
}

/* One of Cheat Engine's own builds beside PATH (its launcher stub or another build). */
static BOOL ce_executable(const WCHAR *path, const WCHAR *executable, WCHAR *target)
{
    if (lstrlenW(path) >= MAX_PATH) return FALSE;
    lstrcpyW(target, path);
    WCHAR *name = target + (file_name(target) - target);
    if (name - target + lstrlenW(executable) + 1 > MAX_PATH) return FALSE;
    lstrcpyW(name, executable);
    DWORD attributes = GetFileAttributesW(target);
    return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

/* A variable this process inherited, if it fits a path. */
static BOOL environment_path(const WCHAR *name, WCHAR *value)
{
    DWORD length = GetEnvironmentVariableW(name, value, MAX_PATH);
    return length > 0 && length < MAX_PATH;
}

static BOOL load_ce_context(HANDLE process, DWORD pid)
{
    WCHAR library[MAX_PATH];
    DWORD length = GetModuleFileNameW(NULL, library, MAX_PATH);
    if (!length || length >= MAX_PATH) return FALSE;
    WCHAR *name = library + (file_name(library) - library);
    if (name - library + ARRAYSIZE(CE_CONTEXT_NAME) > MAX_PATH) return FALSE;
    lstrcpyW(name, CE_CONTEXT_NAME);
    if (GetFileAttributesW(library) == INVALID_FILE_ATTRIBUTES) {
        log_line(L"cannot prepare Cheat Engine: missing %ls", CE_CONTEXT_NAME);
        return FALSE;
    }
    LPTHREAD_START_ROUTINE load = (LPTHREAD_START_ROUTINE)(void (*)(void))GetProcAddress(
        GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW");
    SIZE_T size = (lstrlenW(library) + 1) * sizeof(WCHAR);
    void *remote = VirtualAllocEx(process, NULL, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    HANDLE thread = NULL;
    if (remote && WriteProcessMemory(process, remote, library, size, NULL))
        thread = CreateRemoteThread(process, NULL, 0, load, remote, 0, NULL);
    DWORD error = thread ? 0 : GetLastError();
    DWORD waited = thread ? WaitForSingleObject(thread, 15000) : WAIT_FAILED;
    BOOL loaded = waited == WAIT_OBJECT_0 && has_module(process, library);
    if (thread) CloseHandle(thread);
    /* A timed-out loader may still use its argument; terminating the suspended
     * child below releases it. Never free that argument while it is in use. */
    if (remote && waited != WAIT_TIMEOUT) VirtualFreeEx(process, remote, 0, MEM_RELEASE);
    if (loaded) log_line(L"pid %lu prepared for compact Pascal contexts", pid);
    else log_line(L"could not prepare Cheat Engine pid %lu: loader wait %lu, error %lu", pid, waited, error);
    return loaded;
}

/*
 * Loads .gcm-pipewait.dll into the started program. The program needs a
 * moment to initialize first, so this tries a few times; the library itself
 * refuses to stay when it finds nothing to patch.
 */
static void lengthen_pipe_waits(HANDLE process, DWORD pid, const WCHAR *path)
{
    WCHAR library[MAX_PATH];
    DWORD length = GetModuleFileNameW(NULL, library, MAX_PATH);
    if (!length || length >= MAX_PATH) return;
    WCHAR *name = library + length;
    while (name > library && name[-1] != L'\\' && name[-1] != L'/') name--;
    if (name - library + ARRAYSIZE(PIPE_WAIT_NAME) > MAX_PATH) return;
    lstrcpyW(name, PIPE_WAIT_NAME);
    if (GetFileAttributesW(library) == INVALID_FILE_ATTRIBUTES || !waits_for_pipes(path)) return;

    LPTHREAD_START_ROUTINE load = (LPTHREAD_START_ROUTINE)(void (*)(void))GetProcAddress(
        GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW");
    SIZE_T size = (lstrlenW(library) + 1) * sizeof(WCHAR);
    DWORD error = 0;
    for (int attempt = 1; attempt <= HOOK_ATTEMPTS; attempt++) {
        Sleep(300);
        if (WaitForSingleObject(process, 0) == WAIT_OBJECT_0) return;
        void *remote = VirtualAllocEx(process, NULL, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        HANDLE thread = NULL;
        if (remote && WriteProcessMemory(process, remote, library, size, NULL))
            thread = CreateRemoteThread(process, NULL, 0, load, remote, 0, NULL);
        error = thread ? 0 : GetLastError();
        if (thread) {
            WaitForSingleObject(thread, 10000);
            CloseHandle(thread);
        }
        if (remote) VirtualFreeEx(process, remote, 0, MEM_RELEASE);
        if (thread && has_module(process, library)) {
            log_line(L"pid %lu waits longer for its pipes (attempt %d)", pid, attempt);
            return;
        }
    }
    log_line(L"could not lengthen the pipe waits of pid %lu: error %lu", pid, error);
}

static void start_watcher(DWORD pid, const WCHAR *path)
{
    WCHAR self[MAX_PATH];
    DWORD length = GetModuleFileNameW(NULL, self, MAX_PATH);
    if (!length || length >= MAX_PATH) return;
    size_t size = length + lstrlenW(path) + 40;
    WCHAR *command = HeapAlloc(GetProcessHeap(), 0, size * sizeof(WCHAR));
    if (!command) return;
    _snwprintf(command, size, L"\"%ls\" --watch %lu \"%ls\"", self, pid, path);
    command[size - 1] = 0;
    STARTUPINFOW startup;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION started;
    if (CreateProcessW(self, command, NULL, NULL, FALSE, DETACHED_PROCESS, NULL, NULL, &startup, &started)) {
        CloseHandle(started.hThread);
        CloseHandle(started.hProcess);
    } else {
        log_line(L"could not follow pid %lu: error %lu", pid, GetLastError());
    }
    HeapFree(GetProcessHeap(), 0, command);
}

struct windows {
    DWORD pid;
    int visible, hidden;
    WCHAR title[128];
    RECT rect;
};

static BOOL CALLBACK count_window(HWND window, LPARAM data)
{
    struct windows *found = (struct windows *)data;
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    if (pid != found->pid) return TRUE;
    if (!IsWindowVisible(window)) {
        found->hidden++;
        return TRUE;
    }
    if (!found->visible++) {
        GetWindowTextW(window, found->title, ARRAYSIZE(found->title));
        GetWindowRect(window, &found->rect);
    }
    return TRUE;
}

struct dialogs {
    DWORD pid;
    HWND seen[DIALOGS_REMEMBERED];
    int count;
    const WCHAR *name;
};

struct dialog_text {
    WCHAR text[DIALOG_TEXT];
    int length, controls;
};

/* Collects the text of a dialog's labels and text fields; buttons are left out. */
static BOOL CALLBACK collect_text(HWND control, LPARAM data)
{
    struct dialog_text *found = (struct dialog_text *)data;
    found->controls++;
    WCHAR kind[32];
    if (!GetClassNameW(control, kind, ARRAYSIZE(kind))) return TRUE;
    BOOL label = lstrcmpiW(kind, L"Static") == 0;
    if (!label && lstrcmpiW(kind, L"Edit") != 0) return TRUE;
    if (label && (GetWindowLongW(control, GWL_STYLE) & SS_TYPEMASK) == SS_ICON) return TRUE;
    int room = ARRAYSIZE(found->text) - found->length - 2;
    if (room <= 1) return TRUE;
    if (found->length) found->text[found->length++] = L'\n';
    int added = GetWindowTextW(control, found->text + found->length, room);
    if (added > 0) found->length += added;
    else if (found->length) found->length--;
    found->text[found->length] = 0;
    return TRUE;
}

/* Records each message box a program shows, once: a standard dialog with a
 * few controls. A trainer whose own window is a dialog has many more. */
static BOOL CALLBACK find_dialog(HWND window, LPARAM data)
{
    struct dialogs *state = (struct dialogs *)data;
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    if (pid != state->pid || !IsWindowVisible(window)) return TRUE;
    for (int i = 0; i < state->count; i++)
        if (state->seen[i] == window) return TRUE;
    WCHAR kind[16];
    if (!GetClassNameW(window, kind, ARRAYSIZE(kind)) || lstrcmpW(kind, L"#32770") != 0) return TRUE;
    struct dialog_text found;
    ZeroMemory(&found, sizeof(found));
    EnumChildWindows(window, collect_text, (LPARAM)&found);
    if (found.controls > DIALOG_MAX_CONTROLS || !found.length) return TRUE;
    if (state->count < DIALOGS_REMEMBERED) state->seen[state->count++] = window;
    else return TRUE;
    WCHAR title[128];
    if (!GetWindowTextW(window, title, ARRAYSIZE(title))) title[0] = 0;
    event(L"dialog", state->pid, state->name, L"%ls\n%ls", title, found.text);
    log_line(L"%ls (pid %lu) shows a message box \"%ls\"", state->name, state->pid, title);
    return TRUE;
}

/* True when the file at `path` holds `text` as UTF-16. */
static BOOL file_has_text(const WCHAR *path, const WCHAR *text)
{
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, 0, NULL);
    if (file == INVALID_HANDLE_VALUE) return FALSE;
    const BYTE *wanted = (const BYTE *)text;
    DWORD size = lstrlenW(text) * sizeof(WCHAR), chunk = 1 << 20;
    BYTE *buffer = HeapAlloc(GetProcessHeap(), 0, chunk + size);
    BOOL found = FALSE;
    DWORD kept = 0, read = 0;
    /* Each chunk is searched together with the end of the one before it. */
    while (buffer && !found && ReadFile(file, buffer + kept, chunk, &read, NULL) && read) {
        DWORD length = kept + read;
        for (DWORD at = 0; at + size <= length && !found; at++)
            found = buffer[at] == wanted[0] && memcmp(buffer + at, wanted, size) == 0;
        kept = length < size ? length : size - 1;
        memmove(buffer, buffer + length - kept, kept);
    }
    if (buffer) HeapFree(GetProcessHeap(), 0, buffer);
    CloseHandle(file);
    return found;
}

struct hold {
    process_call suspend, resume;
    DWORD steam;
    int count;
    DWORD pids[HELD_MAX];
    HANDLE processes[HELD_MAX];
    volatile LONG released;
    int resumed;
};

static struct hold hold;

/* True for a program inside the Windows folder: Wine's own, like its desktop (explorer.exe). */
static BOOL wine_program(HANDLE process)
{
    WCHAR image[MAX_PATH], windows[MAX_PATH];
    DWORD size = ARRAYSIZE(image);
    UINT length = GetWindowsDirectoryW(windows, ARRAYSIZE(windows));
    if (!QueryFullProcessImageNameW(process, 0, image, &size) || !length || length >= ARRAYSIZE(windows)) return TRUE;
    return size > length && image[length] == L'\\'
        && CompareStringOrdinal(image, (int)length, windows, (int)length, TRUE) == CSTR_EQUAL;
}

/* Resumes everything held, once, whichever of the watcher and its safety thread comes first. */
static void release_held(void)
{
    if (InterlockedExchange(&hold.released, 1)) return;
    for (int i = 0; i < hold.count; i++) {
        if (!hold.processes[i]) continue;
        hold.resume(hold.processes[i]);
        CloseHandle(hold.processes[i]);
        hold.resumed++;
    }
}

/* Lets the game go even if the watcher itself gets stuck while it holds it. */
static DWORD WINAPI release_later(void *unused)
{
    (void)unused;
    Sleep(HOLD_LIMIT_MS + 10000);
    if (!hold.released) log_line(L"the hold outlived its limit; releasing the game");
    release_held();
    return 0;
}

static void hold_process(struct hold *hold, DWORD pid, const WCHAR *name)
{
    for (int i = 0; i < hold->count; i++)
        if (hold->pids[i] == pid) return;
    if (hold->count == HELD_MAX) return;
    HANDLE process = OpenProcess(PROCESS_SUSPEND_RESUME | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (process && pid != hold->steam && wine_program(process)) {
        /* Remembered, so it is not looked at again every poll; it keeps running. */
        CloseHandle(process);
        hold->pids[hold->count] = pid;
        hold->processes[hold->count++] = NULL;
        return;
    }
    LONG status = process ? hold->suspend(process) : -1;
    if (status != 0) {
        log_line(L"could not hold %ls (pid %lu): status 0x%08lx, error %lu", name, pid, status, GetLastError());
        if (process) CloseHandle(process);
        /* Remembered anyway, so it is not tried again every poll. */
        hold->pids[hold->count] = pid;
        hold->processes[hold->count++] = NULL;
        return;
    }
    hold->pids[hold->count] = pid;
    hold->processes[hold->count++] = process;
    log_line(L"held %ls (pid %lu) until the trainer is ready", name, pid);
}

/* Suspends Proton's steam.exe and every process it starts, as they appear. */
static void hold_new_processes(struct hold *hold)
{
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W entry;
    entry.dwSize = sizeof(entry);
    for (BOOL more = Process32FirstW(snapshot, &entry); more; more = Process32NextW(snapshot, &entry)) {
        if (!hold->steam && lstrcmpiW(entry.szExeFile, L"steam.exe") == 0) hold->steam = entry.th32ProcessID;
        if (hold->steam && (entry.th32ProcessID == hold->steam || entry.th32ParentProcessID == hold->steam))
            hold_process(hold, entry.th32ProcessID, entry.szExeFile);
    }
    CloseHandle(snapshot);
}

/*
 * Keeps the game from starting until a trainer that must run first is ready:
 * its window has been visible for HOLD_GRACE_MS. Gives up after HOLD_LIMIT_MS
 * or when the trainer exits. Returns the whole seconds it took.
 */
static int hold_game(HANDLE trainer, DWORD pid, const WCHAR *name)
{
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    hold.suspend = (process_call)(void (*)(void))GetProcAddress(ntdll, "NtSuspendProcess");
    hold.resume = (process_call)(void (*)(void))GetProcAddress(ntdll, "NtResumeProcess");
    if (!hold.suspend || !hold.resume) return 0;
    log_line(L"%ls (pid %lu) must start before the game: holding the game until it is ready", name, pid);
    HANDLE safety = CreateThread(NULL, 0, release_later, NULL, 0, NULL);
    if (safety) CloseHandle(safety);
    DWORD begun = GetTickCount(), shown = 0;
    const WCHAR *reason = L"time limit";
    for (;;) {
        hold_new_processes(&hold);
        DWORD now = GetTickCount();
        if (WaitForSingleObject(trainer, HOLD_POLL_MS) == WAIT_OBJECT_0) {
            reason = L"trainer exited";
            break;
        }
        if (!shown) {
            struct windows found;
            ZeroMemory(&found, sizeof(found));
            found.pid = pid;
            EnumWindows(count_window, (LPARAM)&found);
            if (found.visible) shown = now;
        }
        if (shown && now - shown >= HOLD_GRACE_MS) {
            reason = L"trainer ready";
            break;
        }
        if (now - begun >= HOLD_LIMIT_MS) break;
    }
    release_held();
    int seconds = (int)((GetTickCount() - begun) / 1000);
    log_line(L"released %d held processes after %d s (%ls)", hold.resumed, seconds, reason);
    event(L"hold", pid, name, L"%d %d %ls", seconds, hold.resumed, reason);
    return seconds;
}

/*
 * A program that ends cleanly this soon handed its work to the programs it
 * started (Cheat Engine.exe starts the build for this CPU and exits): those
 * are followed in its place.
 */
static void follow_children(DWORD pid, const WCHAR *name)
{
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W entry;
    entry.dwSize = sizeof(entry);
    int followed = 0;
    for (BOOL more = Process32FirstW(snapshot, &entry); more && followed < 4; more = Process32NextW(snapshot, &entry)) {
        if (entry.th32ParentProcessID != pid || entry.th32ProcessID == GetCurrentProcessId()) continue;
        HANDLE child = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID);
        if (!child) continue;
        WCHAR image[MAX_PATH];
        DWORD size = ARRAYSIZE(image);
        if (WaitForSingleObject(child, 0) == WAIT_TIMEOUT && !wine_program(child)
            && QueryFullProcessImageNameW(child, 0, image, &size)) {
            log_line(L"%ls (pid %lu) handed over to %ls (pid %lu)", name, pid, entry.szExeFile, entry.th32ProcessID);
            event(L"handoff", pid, name, L"%lu %ls", entry.th32ProcessID, entry.szExeFile);
            start_watcher(entry.th32ProcessID, image);
            followed++;
        }
        CloseHandle(child);
    }
    CloseHandle(snapshot);
}

/*
 * Follows a started program until it exits: whether it opens a window within
 * WATCH_SECONDS, each message box it shows, and its exit code. It is a Wine
 * system process, so wineserver ends it with the game.
 */
static int watch(const WCHAR *pid_text, const WCHAR *path)
{
    /* Like the trainer, the watcher must not keep the game running in Steam. */
    make_system(GetCurrentProcess());
    DWORD pid = wcstoul(pid_text, NULL, 10);
    const WCHAR *name = file_name(path);
    HANDLE process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    int held = 0;
    if (process && file_has_text(path, HOLD_TEXT)) held = hold_game(process, pid, name);
    if (!process) {
        log_line(L"cannot follow %ls (pid %lu): error %lu", name, pid, GetLastError());
        event(L"unwatched", pid, name, L"%lu", GetLastError());
        return 1;
    }
    struct windows found;
    ZeroMemory(&found, sizeof(found));
    struct dialogs dialogs;
    ZeroMemory(&dialogs, sizeof(dialogs));
    dialogs.pid = pid;
    dialogs.name = name;
    BOOL shown = FALSE;
    for (int second = held + 1;; second++) {
        if (WaitForSingleObject(process, 1000) == WAIT_OBJECT_0) {
            DWORD code = 0;
            GetExitCodeProcess(process, &code);
            log_line(L"%ls (pid %lu) exited after %d s with code 0x%08lx", name, pid, second, code);
            event(L"exit", pid, name, L"0x%08lx %d", code, second);
            if (code == 0 && second - held <= HAND_OFF_SECONDS) follow_children(pid, name);
            break;
        }
        if (!shown) {
            ZeroMemory(&found, sizeof(found));
            found.pid = pid;
            EnumWindows(count_window, (LPARAM)&found);
            if (found.visible) {
                shown = TRUE;
                log_line(L"%ls (pid %lu) opened a window after %d s: \"%ls\" %ldx%ld at %ld,%ld (%d visible, %d hidden)",
                         name, pid, second, found.title, found.rect.right - found.rect.left,
                         found.rect.bottom - found.rect.top, found.rect.left, found.rect.top, found.visible,
                         found.hidden);
                event(L"window", pid, name, L"%d %ls", second, found.title);
            } else if (second == WATCH_SECONDS) {
                log_line(L"%ls (pid %lu) still runs after %d s without a visible window (%d hidden)", name, pid,
                         WATCH_SECONDS, found.hidden);
                event(L"nowindow", pid, name, L"%d", WATCH_SECONDS);
            }
        }
        if (shown) EnumWindows(find_dialog, (LPARAM)&dialogs);
    }
    CloseHandle(process);
    return 0;
}

int main(void)
{
    init_log();
    int count = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &count);
    if (argv && count == 4 && lstrcmpW(argv[1], L"--watch") == 0) return watch(argv[2], argv[3]);
    const WCHAR *path, *argument;
    WCHAR remembered[MAX_PATH], i386[MAX_PATH], table[MAX_PATH];
    BOOL ce;
    if (argv && count == 2 && lstrcmpW(argv[1], L"--ce-i386") == 0) {
        /* Sent by the bridge in the 64-bit Cheat Engine once it is attached to a
         * 32-bit game. Cheat Engine and its table come from the variables the
         * first start left in that Cheat Engine's environment, still UTF-16:
         * nothing else holds a path in another language without loss. */
        if (!environment_path(CE_PATH_VARIABLE, remembered)
            || !ce_executable(remembered, L"cheatengine-i386.exe", i386)) {
            log_line(L"cannot find the 32-bit Cheat Engine executable for --ce-i386");
            return 1;
        }
        ce = TRUE;
        path = i386;
        argument = environment_path(CE_TABLE_VARIABLE, table) ? table : NULL;
    } else {
        ce = argv && count >= 2 && lstrcmpW(argv[1], L"--ce") == 0;
        int first = ce ? 2 : 1;
        if (!argv || count < first + 1 || count > first + 2) {
            log_line(L"expected one program and at most one argument, got %d arguments", argv ? count - 1 : 0);
            return 1;
        }
        path = argv[first];
        argument = count == first + 2 ? argv[first + 1] : NULL;
    }
    if (ce) {
        /* Inherited by Cheat Engine, and from it by the starter it runs for --ce-i386. */
        SetEnvironmentVariableW(CE_PATH_VARIABLE, path);
        SetEnvironmentVariableW(CE_TABLE_VARIABLE, argument);
    }
    /* The bridge restarts a 32-bit game's Cheat Engine as cheatengine-i386.exe:
     * that build keeps its own path, and the 64-bit context adapter is not for it. */
    BOOL adapt = ce && arm64_wine() && lstrcmpiW(file_name(path), L"cheatengine-i386.exe") != 0;
    WCHAR engine[MAX_PATH];
    if (adapt) {
        if (!ce_executable(path, L"cheatengine-x86_64.exe", engine)) {
            log_line(L"cannot find the 64-bit Cheat Engine executable beside %ls", path);
            return 1;
        }
        path = engine;
    }
    size_t length = lstrlenW(path);
    size_t extra = argument ? lstrlenW(argument) + 3 : 0;
    /* The command line is the quoted path, then the quoted argument; the working directory is the program's folder. */
    WCHAR *command = HeapAlloc(GetProcessHeap(), 0, (length + 3 + extra) * sizeof(WCHAR));
    WCHAR *folder = HeapAlloc(GetProcessHeap(), 0, (length + 1) * sizeof(WCHAR));
    if (!command || !folder) return 1;
    command[0] = L'"';
    lstrcpyW(command + 1, path);
    command[length + 1] = L'"';
    command[length + 2] = 0;
    if (argument) {
        lstrcatW(command, L" \"");
        lstrcatW(command, argument);
        lstrcatW(command, L"\"");
    }
    lstrcpyW(folder, path);
    WCHAR *slash = folder + length;
    while (slash > folder && *slash != L'\\' && *slash != L'/') slash--;
    if (slash > folder) *slash = 0;

    STARTUPINFOW startup;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION started;
    if (!CreateProcessW(path, command, NULL, NULL, FALSE, CREATE_NEW_CONSOLE | (adapt ? CREATE_SUSPENDED : 0), NULL,
                        slash > folder ? folder : NULL, &startup, &started)) {
        DWORD error = GetLastError();
        log_line(L"could not start %ls: error %lu", path, error);
        event(L"failed", 0, file_name(path), L"%lu", error);
        return 1;
    }
    event(L"started", started.dwProcessId, file_name(path), L"%ls", ce ? L"ce" : L"");
    LONG status = make_system(started.hProcess);
    log_line(L"started %ls%ls%ls as pid %lu (system process: %ls)", path, argument ? L" with " : L"",
             argument ? argument : L"", started.dwProcessId,
             status == 0 ? L"yes" : status == -1 ? L"not supported" : L"failed");
    log_machine(started.hProcess, started.dwProcessId);
    if (adapt && (!load_ce_context(started.hProcess, started.dwProcessId) || ResumeThread(started.hThread) == (DWORD)-1)) {
        TerminateProcess(started.hProcess, 1);
        CloseHandle(started.hThread);
        CloseHandle(started.hProcess);
        return 1;
    }
    /* First: the watcher may have to hold the game, which Proton starts soon. */
    start_watcher(started.dwProcessId, path);
    if (!ce) lengthen_pipe_waits(started.hProcess, started.dwProcessId, path);
    CloseHandle(started.hThread);
    CloseHandle(started.hProcess);
    return 0;
}
