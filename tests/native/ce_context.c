/* Run with a Windows x64 compiler, or MinGW-w64 followed by Wine.
 * The fake APIs write the whole Windows record, reproducing ARM64EC's
 * overflow without requiring an ARM device or Cheat Engine. */
#include "../../native/gcm_ce_context.c"
#include <assert.h>
#include <stdio.h>

struct guarded_context { BYTE before[16], context[FPC_CONTEXT_SIZE], after[16]; };

static void guards(const struct guarded_context *value)
{
    for (unsigned i = 0; i < 16; i++) {
        assert(value->before[i] == 0xa5);
        assert(value->after[i] == 0xa5);
    }
}

static VOID WINAPI full_capture(PCONTEXT context)
{
    memset(context, 0, sizeof(*context));
    context->Rax = 42;
    context->VectorRegister[0].Low = 123;
    context->LastExceptionFromRip = 456;
}

static VOID WINAPI full_unwind(PVOID frame, PVOID target, PEXCEPTION_RECORD exception,
    PVOID result, PCONTEXT context, PUNWIND_HISTORY_TABLE history)
{
    (void)frame; (void)target; (void)exception; (void)result; (void)history;
    memset(context, 0, sizeof(*context));
}

static PEXCEPTION_ROUTINE WINAPI full_virtual(DWORD type, DWORD64 base, DWORD64 pc,
    PRUNTIME_FUNCTION function, PCONTEXT context, PVOID *handler, PDWORD64 frame,
    PKNONVOLATILE_CONTEXT_POINTERS pointers)
{
    (void)type; (void)base; (void)pc; (void)function; (void)handler; (void)frame;
    assert(context->Rax == 42 && context->VectorRegister[0].Low == 123);
    memset(context, 0, sizeof(*context));
    context->Rbp = 789;
    context->LastExceptionFromRip = 987;
    pointers->IntegerContext[0] = &context->Rbp;
    return NULL;
}

static void runtime_detection(void)
{
    BYTE image[2048] = {0};
    IMAGE_NT_HEADERS nt = {0};
    nt.OptionalHeader.SizeOfImage = sizeof(image);
    nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXCEPTION].VirtualAddress = 256;
    nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXCEPTION].Size = sizeof(RUNTIME_FUNCTION);
    RUNTIME_FUNCTION *entry = (RUNTIME_FUNCTION *)(image + 256);
    entry->BeginAddress = 512;
    /* FPC's emitted local-unwind helper: a 0x470-byte context, shadow space,
     * one direct call to an import thunk, then the matching stack restore. */
    const BYTE helper[] = {
        0x48,0x8d,0xa4,0x24,0x58,0xfb,0xff,0xff,0x48,0x89,0xc8,
        0x48,0xc7,0x44,0x24,0x28,0,0,0,0,0x48,0x8d,0x4c,0x24,0x30,
        0x48,0x89,0x4c,0x24,0x20,0x48,0x89,0xc1,0x4d,0x31,0xc9,
        0x4d,0x31,0xc0,0xe8,0,0,0,0,0x90,0x48,0x8d,0xa4,0x24,0xa8,0x04,0,0,0xc3
    };
    memcpy(image + 512, helper, sizeof(helper));
    LONG displacement = 768 - (512 + 44);
    memcpy(image + 512 + 40, &displacement, 4);
    image[768] = 0xff; image[769] = 0x25;
    displacement = 1024 - (768 + 6);
    memcpy(image + 770, &displacement, 4);
    ULONG_PTR original = (ULONG_PTR)full_unwind;
    memcpy(image + 1024, &original, sizeof(original));
    assert(compact_runtime(image, &nt, original));
    /* The same helper with a larger context must never get compact adapters. */
    image[516] = 0xf8;
    assert(!compact_runtime(image, &nt, original));
    image[516] = helper[4];
    assert(!compact_runtime(image, &nt, original + 1));
    nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXCEPTION].Size = sizeof(image);
    assert(!compact_runtime(image, &nt, original));
}

int main(void)
{
    runtime_detection();
    struct guarded_context value;
    memset(&value, 0xa5, sizeof(value));
    original_capture = full_capture;
    safe_capture((PCONTEXT)value.context);
    guards(&value);
    CONTEXT full;
    expand(&full, value.context);
    assert(full.Rax == 42 && full.VectorRegister[0].Low == 123 && full.LastExceptionFromRip == 456);
    for (unsigned i = FLOAT_PREFIX; i < WINDOWS_VECTOR_OFFSET; i++) assert(((BYTE *)&full)[i] == 0);
    KNONVOLATILE_CONTEXT_POINTERS pointers = {0};
    original_virtual = full_virtual;
    safe_virtual(0, 0, 0, NULL, (PCONTEXT)value.context, NULL, NULL, &pointers);
    guards(&value);
    expand(&full, value.context);
    assert(full.Rbp == 789 && full.LastExceptionFromRip == 987);
    assert(pointers.IntegerContext[0] == (PDWORD64)(value.context + FIELD_OFFSET(CONTEXT, Rbp)));
    original_unwind = full_unwind;
    safe_unwind(NULL, NULL, NULL, NULL, (PCONTEXT)value.context, NULL);
    guards(&value);
    expand(&full, value.context);
    assert(full.Rbp == 789);
    puts("Compact context guards, register mapping and pointer lifetime passed");
    return 0;
}
