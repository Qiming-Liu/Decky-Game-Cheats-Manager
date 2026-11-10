/*
 * Starts one trainer program and marks it a Wine system process.
 *
 * Proton's steam.exe treats the game as finished only when every non-system
 * Wine process in the prefix has exited, so a trainer left open keeps the game
 * "running" in Steam. A system process does not count: once the game exits,
 * steam.exe returns and wineserver closes the trainer during its shutdown.
 * On Windows, or a Wine without this call, the program still starts normally.
 *
 * Usage: gcm-start.exe "C:\path\to\trainer.exe"
 * Exit code: 0 when the program started, 1 otherwise.
 */
#include <windows.h>
#include <shellapi.h>

#define PROCESS_WINE_MAKE_PROCESS_SYSTEM 1000

typedef LONG(NTAPI *set_information_process)(HANDLE, ULONG, PVOID, ULONG);

static void make_system(HANDLE process)
{
    set_information_process set = (set_information_process)(void (*)(void))GetProcAddress(
        GetModuleHandleW(L"ntdll.dll"), "NtSetInformationProcess");
    HANDLE shutdown_event = NULL;
    if (set && set(process, PROCESS_WINE_MAKE_PROCESS_SYSTEM, &shutdown_event, sizeof(shutdown_event)) == 0 && shutdown_event)
        CloseHandle(shutdown_event);
}

int main(void)
{
    int count = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!argv || count != 2) return 1;
    const WCHAR *path = argv[1];
    size_t length = lstrlenW(path);
    /* The command line is the quoted path; the working directory is its folder. */
    WCHAR *command = HeapAlloc(GetProcessHeap(), 0, (length + 3) * sizeof(WCHAR));
    WCHAR *folder = HeapAlloc(GetProcessHeap(), 0, (length + 1) * sizeof(WCHAR));
    if (!command || !folder) return 1;
    command[0] = L'"';
    lstrcpyW(command + 1, path);
    command[length + 1] = L'"';
    command[length + 2] = 0;
    lstrcpyW(folder, path);
    WCHAR *slash = folder + length;
    while (slash > folder && *slash != L'\\' && *slash != L'/') slash--;
    if (slash > folder) *slash = 0;

    STARTUPINFOW startup;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION started;
    if (!CreateProcessW(path, command, NULL, NULL, FALSE, CREATE_NEW_CONSOLE, NULL,
                        slash > folder ? folder : NULL, &startup, &started))
        return 1;
    make_system(started.hProcess);
    CloseHandle(started.hThread);
    CloseHandle(started.hProcess);
    return 0;
}
