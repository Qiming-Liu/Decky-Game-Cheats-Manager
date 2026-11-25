/*
 * Adapts the compact Win64 CONTEXT used by older Free Pascal runtimes.
 *
 * Their record omits the 96 reserved bytes at the end of XMM_SAVE_AREA32:
 * sizeof(TContext) is 0x470, while the Windows CONTEXT is 0x4d0. Native x64
 * Wine leaves those unused fields alone. ARM64EC Wine writes the complete
 * record, overwriting the caller's saved registers and return address.
 *
 * The starter loads this library before Cheat Engine's entry point, only on
 * ARM64 Wine. It recognizes the undersized FPC local-unwind helper before
 * changing the main executable's three context imports. Newer layouts and
 * every other module keep their original imports. No executable is modified
 * on disk, and exception/finally handlers still run through Wine.
 */
#define _WIN32_WINNT 0x0602
#include <windows.h>
#include <string.h>

#define FPC_CONTEXT_SIZE 0x470
#define FLOAT_PREFIX 0x2a0
#define WINDOWS_VECTOR_OFFSET 0x300

typedef VOID (WINAPI *unwind_ex)(PVOID, PVOID, PEXCEPTION_RECORD, PVOID, PCONTEXT, PUNWIND_HISTORY_TABLE);
typedef VOID (WINAPI *capture_context)(PCONTEXT);
typedef PEXCEPTION_ROUTINE (WINAPI *virtual_unwind)(DWORD, DWORD64, DWORD64, PRUNTIME_FUNCTION,
                                                 PCONTEXT, PVOID *, PDWORD64, PKNONVOLATILE_CONTEXT_POINTERS);
static unwind_ex original_unwind;
static capture_context original_capture;
static virtual_unwind original_virtual;

_Static_assert(sizeof(CONTEXT) == 0x4d0, "Expected the Windows x64 CONTEXT layout");
_Static_assert(FIELD_OFFSET(CONTEXT, VectorRegister) == WINDOWS_VECTOR_OFFSET, "Unexpected vector offset");

static void compact(void *target, const CONTEXT *source)
{
    memcpy(target, source, FLOAT_PREFIX);
    memcpy((BYTE *)target + FLOAT_PREFIX, (const BYTE *)source + WINDOWS_VECTOR_OFFSET,
           FPC_CONTEXT_SIZE - FLOAT_PREFIX);
}

static void expand(CONTEXT *target, const void *source)
{
    ZeroMemory(target, sizeof(*target));
    memcpy(target, source, FLOAT_PREFIX);
    memcpy((BYTE *)target + WINDOWS_VECTOR_OFFSET, (const BYTE *)source + FLOAT_PREFIX,
           FPC_CONTEXT_SIZE - FLOAT_PREFIX);
}

static VOID WINAPI safe_unwind(PVOID frame, PVOID target, PEXCEPTION_RECORD exception,
                              PVOID result, PCONTEXT ignored, PUNWIND_HISTORY_TABLE history)
{
    /* RtlUnwindEx ignores the initial contents and never returns normally. */
    (void)ignored;
    CONTEXT context;
    original_unwind(frame, target, exception, result, &context, history);
}

static VOID WINAPI safe_capture(PCONTEXT target)
{
    CONTEXT context;
    original_capture(&context);
    /* Return the caller's snapshot, rather than this adapter's temporary frame. */
    DWORD64 base, frame;
    PVOID handler;
    PRUNTIME_FUNCTION function = RtlLookupFunctionEntry(context.Rip, &base, NULL);
    if (function) RtlVirtualUnwind(0, base, context.Rip, function, &context, &handler, &frame, NULL);
    compact(target, &context);
}

static PEXCEPTION_ROUTINE WINAPI safe_virtual(DWORD type, DWORD64 base, DWORD64 pc,
    PRUNTIME_FUNCTION function, PCONTEXT context, PVOID *handler, PDWORD64 frame,
    PKNONVOLATILE_CONTEXT_POINTERS pointers)
{
    CONTEXT full;
    expand(&full, context);
    PEXCEPTION_ROUTINE result = original_virtual(type, base, pc, function, &full, handler, frame, pointers);
    compact(context, &full);
    /* A provider may return pointers into the supplied context. Preserve their lifetime. */
    if (pointers) {
        for (unsigned i = 0; i < sizeof(*pointers) / sizeof(void *); i++) {
            ULONG_PTR value = (ULONG_PTR)((void **)pointers)[i];
            if (value >= (ULONG_PTR)&full && value < (ULONG_PTR)&full + sizeof(full)) {
                SIZE_T offset = value - (ULONG_PTR)&full;
                ((void **)pointers)[i] = offset < FLOAT_PREFIX ? (BYTE *)context + offset
                    : offset >= WINDOWS_VECTOR_OFFSET ? (BYTE *)context + offset - 0x60 : NULL;
            }
        }
    }
    return result;
}

/* The compiler's local-unwind helper has one compact context and no other locals.
 * Check its complete argument setup, stack restore and import thunk, not an address
 * tied to one Cheat Engine release. A corrected compiler allocates a larger frame. */
static BOOL compact_runtime(BYTE *base, const IMAGE_NT_HEADERS *nt, ULONG_PTR unwind)
{
    static const BYTE prefix[] = {
        0x48,0x8d,0xa4,0x24,0x58,0xfb,0xff,0xff,0x48,0x89,0xc8,
        0x48,0xc7,0x44,0x24,0x28,0,0,0,0,0x48,0x8d,0x4c,0x24,0x30,
        0x48,0x89,0x4c,0x24,0x20,0x48,0x89,0xc1,0x4d,0x31,0xc9,
        0x4d,0x31,0xc0,0xe8
    };
    static const BYTE suffix[] = {0x90,0x48,0x8d,0xa4,0x24,0xa8,0x04,0,0,0xc3};
    IMAGE_DATA_DIRECTORY directory = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXCEPTION];
    SIZE_T size = nt->OptionalHeader.SizeOfImage;
    if (!directory.VirtualAddress || directory.VirtualAddress >= size || directory.Size > size - directory.VirtualAddress)
        return FALSE;
    const RUNTIME_FUNCTION *entries = (const RUNTIME_FUNCTION *)(base + directory.VirtualAddress);
    for (unsigned i = 0; i < directory.Size / sizeof(*entries); i++) {
        DWORD rva = entries[i].BeginAddress;
        if (rva >= size || size - rva < 54) continue;
        const BYTE *code = base + rva;
        if (memcmp(code, prefix, sizeof(prefix)) || memcmp(code + 44, suffix, sizeof(suffix))) continue;
        LONG displacement;
        memcpy(&displacement, code + 40, sizeof(displacement));
        LONGLONG thunk = (LONGLONG)rva + 44 + displacement;
        if (thunk < 0 || (ULONGLONG)thunk + 6 > size || base[thunk] != 0xff || base[thunk + 1] != 0x25) continue;
        memcpy(&displacement, base + thunk + 2, sizeof(displacement));
        LONGLONG slot = thunk + 6 + displacement;
        if (slot < 0 || (ULONGLONG)slot + sizeof(ULONG_PTR) > size) continue;
        ULONG_PTR value;
        memcpy(&value, base + slot, sizeof(value));
        if (value == unwind) return TRUE;
    }
    return FALSE;
}

BOOL WINAPI DllMain(HINSTANCE self, DWORD reason, LPVOID reserved)
{
    (void)reserved;
    if (reason != DLL_PROCESS_ATTACH) return TRUE;
    DisableThreadLibraryCalls(self);
    BYTE *base = (BYTE *)GetModuleHandleW(NULL);
    IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)(base + ((IMAGE_DOS_HEADER *)base)->e_lfanew);
    if (nt->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64) return TRUE;
    IMAGE_DATA_DIRECTORY imports = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    if (!imports.VirtualAddress) return TRUE;
    struct patch { const char *name; void *replacement; void **original; ULONG_PTR *slot; } patches[] = {
        {"RtlUnwindEx", safe_unwind, (void **)&original_unwind, NULL},
        {"RtlCaptureContext", safe_capture, (void **)&original_capture, NULL},
        {"RtlVirtualUnwind", safe_virtual, (void **)&original_virtual, NULL}
    };
    for (IMAGE_IMPORT_DESCRIPTOR *entry = (IMAGE_IMPORT_DESCRIPTOR *)(base + imports.VirtualAddress); entry->Name; entry++) {
        if (!entry->OriginalFirstThunk) continue;
        IMAGE_THUNK_DATA *names = (IMAGE_THUNK_DATA *)(base + entry->OriginalFirstThunk);
        IMAGE_THUNK_DATA *slots = (IMAGE_THUNK_DATA *)(base + entry->FirstThunk);
        for (; names->u1.AddressOfData; names++, slots++) {
            if (IMAGE_SNAP_BY_ORDINAL(names->u1.Ordinal)) continue;
            IMAGE_IMPORT_BY_NAME *name = (IMAGE_IMPORT_BY_NAME *)(base + names->u1.AddressOfData);
            for (unsigned i = 0; i < ARRAYSIZE(patches); i++) {
                if (!strcmp((const char *)name->Name, patches[i].name)) {
                    patches[i].slot = (ULONG_PTR *)&slots->u1.Function;
                    *patches[i].original = (void *)(ULONG_PTR)slots->u1.Function;
                }
            }
        }
    }
    for (unsigned i = 0; i < ARRAYSIZE(patches); i++) if (!patches[i].slot) return TRUE;
    if (!compact_runtime(base, nt, (ULONG_PTR)original_unwind)) return TRUE;
    /* Make every slot writable before changing any: an attach failure leaves no dangling hooks. */
    DWORD protections[ARRAYSIZE(patches)];
    unsigned writable = 0;
    for (; writable < ARRAYSIZE(patches); writable++) {
        if (!VirtualProtect(patches[writable].slot, sizeof(ULONG_PTR), PAGE_READWRITE, &protections[writable])) break;
    }
    BOOL ready = writable == ARRAYSIZE(patches);
    if (ready) for (unsigned i = 0; i < ARRAYSIZE(patches); i++) *patches[i].slot = (ULONG_PTR)patches[i].replacement;
    while (writable) {
        writable--;
        DWORD ignored;
        VirtualProtect(patches[writable].slot, sizeof(ULONG_PTR), protections[writable], &ignored);
    }
    return ready;
}
