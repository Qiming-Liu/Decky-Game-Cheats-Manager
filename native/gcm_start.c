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
 * follows the program for up to WATCH_SECONDS and records whether it opened a
 * window or exited, so the next program on the launcher's list starts at once.
 *
 * Usage: gcm-start.exe "C:\path\to\trainer.exe"
 *        gcm-start.exe --watch PID "C:\path\to\trainer.exe"   (started by itself)
 * Exit code: 0 when the program started, 1 otherwise.
 */
#include <windows.h>
#include <shellapi.h>
#include <stdarg.h>
#include <stdio.h>
#include <wchar.h>

#define PROCESS_WINE_MAKE_PROCESS_SYSTEM 1000
#define LOG_NAME L".gcm-launch.log"
/* The plugin empties the log after reading it; this only bounds a log nobody reads. */
#define LOG_LIMIT (256 * 1024)
#define WATCH_SECONDS 30

typedef LONG(NTAPI *set_information_process)(HANDLE, ULONG, PVOID, ULONG);
typedef BOOL(WINAPI *is_wow64_process2)(HANDLE, USHORT *, USHORT *);

static WCHAR log_path[MAX_PATH + 32];

static void init_log(void)
{
    DWORD length = GetModuleFileNameW(NULL, log_path, MAX_PATH);
    if (!length || length >= MAX_PATH) {
        log_path[0] = 0;
        return;
    }
    WCHAR *name = log_path + length;
    while (name > log_path && name[-1] != L'\\' && name[-1] != L'/') name--;
    lstrcpyW(name, LOG_NAME);
}

/* Appends one line, prefixed with the local time. Failures are ignored. */
static void log_line(const WCHAR *format, ...)
{
    if (!log_path[0]) return;
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

    char bytes[sizeof(text) * 3 / sizeof(WCHAR)];
    int size = WideCharToMultiByte(CP_UTF8, 0, text, used, bytes, sizeof(bytes), NULL, NULL);
    if (size <= 0) return;
    HANDLE file = CreateFileW(log_path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                              OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return;
    LARGE_INTEGER length;
    if (GetFileSizeEx(file, &length) && length.QuadPart > LOG_LIMIT) {
        CloseHandle(file);
        file = CreateFileW(log_path, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                           CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (file == INVALID_HANDLE_VALUE) return;
    }
    DWORD written;
    WriteFile(file, bytes, (DWORD)size, &written, NULL);
    CloseHandle(file);
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

/* Follows a started program until it shows a window or exits, or WATCH_SECONDS pass. */
static int watch(const WCHAR *pid_text, const WCHAR *path)
{
    /* Like the trainer, the watcher must not keep the game running in Steam. */
    make_system(GetCurrentProcess());
    DWORD pid = wcstoul(pid_text, NULL, 10);
    const WCHAR *name = file_name(path);
    HANDLE process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) {
        log_line(L"cannot follow %ls (pid %lu): error %lu", name, pid, GetLastError());
        return 1;
    }
    struct windows found;
    ZeroMemory(&found, sizeof(found));
    for (int second = 1; second <= WATCH_SECONDS; second++) {
        if (WaitForSingleObject(process, 1000) == WAIT_OBJECT_0) {
            DWORD code = 0;
            GetExitCodeProcess(process, &code);
            log_line(L"%ls (pid %lu) exited after %d s with code 0x%08lx", name, pid, second, code);
            CloseHandle(process);
            return 0;
        }
        ZeroMemory(&found, sizeof(found));
        found.pid = pid;
        EnumWindows(count_window, (LPARAM)&found);
        if (found.visible) {
            log_line(L"%ls (pid %lu) opened a window after %d s: \"%ls\" %ldx%ld at %ld,%ld (%d visible, %d hidden)",
                     name, pid, second, found.title, found.rect.right - found.rect.left,
                     found.rect.bottom - found.rect.top, found.rect.left, found.rect.top, found.visible, found.hidden);
            CloseHandle(process);
            return 0;
        }
    }
    log_line(L"%ls (pid %lu) still runs after %d s without a visible window (%d hidden)", name, pid,
             WATCH_SECONDS, found.hidden);
    CloseHandle(process);
    return 0;
}

int main(void)
{
    init_log();
    int count = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &count);
    if (argv && count == 4 && lstrcmpW(argv[1], L"--watch") == 0) return watch(argv[2], argv[3]);
    if (!argv || count != 2) {
        log_line(L"expected one program, got %d arguments", argv ? count - 1 : 0);
        return 1;
    }
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
                        slash > folder ? folder : NULL, &startup, &started)) {
        log_line(L"could not start %ls: error %lu", path, GetLastError());
        return 1;
    }
    LONG status = make_system(started.hProcess);
    log_line(L"started %ls as pid %lu (system process: %ls)", path, started.dwProcessId,
             status == 0 ? L"yes" : status == -1 ? L"not supported" : L"failed");
    log_machine(started.hProcess, started.dwProcessId);
    start_watcher(started.dwProcessId, path);
    CloseHandle(started.hThread);
    CloseHandle(started.hProcess);
    return 0;
}
