#include "shared/process_utils.h"
#include "shared/logger.h"
#include <thread>
#include <chrono>
#include <cstdlib>
#include <sstream>
#include <fstream>
#include <regex>
#include <algorithm>

#ifdef _WIN32
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <process.h>
#include <winsvc.h>
#pragma comment(lib, "advapi32.lib")
#else
#include <unistd.h>
#include <signal.h>
#include <sys/types.h>
#include <sys/wait.h>
#endif

namespace league_monitor {

static std::unique_ptr<Logger> logger_ = nullptr;

Logger& ProcessUtils::getLogger() {
    if (!logger_) {
        logger_ = std::make_unique<Logger>("ProcessUtils");
    }
    return *logger_;
}

bool ProcessUtils::isProcessRunning(const std::string& processName) {
#ifdef _WIN32
    std::string processNameExe = processName;
    std::transform(processNameExe.begin(), processNameExe.end(), processNameExe.begin(), ::tolower);
    if (processNameExe.find(".exe") == std::string::npos) {
        processNameExe += ".exe";
    }
    
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        return false;
    }
    
    PROCESSENTRY32 entry;
    entry.dwSize = sizeof(PROCESSENTRY32);
    
    bool found = false;
    if (Process32First(snapshot, &entry)) {
        do {
            std::string name = entry.szExeFile;
            std::transform(name.begin(), name.end(), name.begin(), ::tolower);
            if (name == processNameExe) {
                found = true;
                break;
            }
        } while (Process32Next(snapshot, &entry));
    }
    
    CloseHandle(snapshot);
    return found;
#else
    std::ostringstream cmd;
    cmd << "pgrep -x \"" << processName << "\"";
    
    FILE* pipe = popen(cmd.str().c_str(), "r");
    if (!pipe) return false;
    
    char buffer[128];
    std::string result = "";
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
        result += buffer;
    }
    
    int status = pclose(pipe);
    return result.length() > 0;
#endif
}

std::vector<uint32_t> ProcessUtils::getProcessPids(const std::string& processName) {
    std::vector<uint32_t> pids;
    
#ifdef _WIN32
    std::string processNameExe = processName;
    std::transform(processNameExe.begin(), processNameExe.end(), processNameExe.begin(), ::tolower);
    if (processNameExe.find(".exe") == std::string::npos) {
        processNameExe += ".exe";
    }
    
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        return pids;
    }
    
    PROCESSENTRY32 entry;
    entry.dwSize = sizeof(PROCESSENTRY32);
    
    if (Process32First(snapshot, &entry)) {
        do {
            std::string name = entry.szExeFile;
            std::transform(name.begin(), name.end(), name.begin(), ::tolower);
            if (name == processNameExe) {
                pids.push_back(entry.th32ProcessID);
            }
        } while (Process32Next(snapshot, &entry));
    }
    
    CloseHandle(snapshot);
#else
    std::ostringstream cmd;
    cmd << "pgrep -x \"" << processName << "\"";
    
    FILE* pipe = popen(cmd.str().c_str(), "r");
    if (!pipe) return pids;
    
    char buffer[128];
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
        try {
            uint32_t pid = static_cast<uint32_t>(std::stoi(buffer));
            pids.push_back(pid);
        } catch (...) {
            // Skip invalid lines
        }
    }
    
    pclose(pipe);
#endif
    
    return pids;
}

bool ProcessUtils::killProcess(uint32_t pid) {
#ifdef _WIN32
    HANDLE handle = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
    if (handle == NULL) {
        // Process might already be gone
        getLogger().info("Process with PID " + std::to_string(pid) + " already terminated or doesn't exist");
        return true;
    }
    
    bool result = TerminateProcess(handle, 0);
    CloseHandle(handle);
    
    if (result) {
        getLogger().info("Killed process with PID: " + std::to_string(pid));
        return true;
    }
    return false;
#else
    if (kill(pid, SIGKILL) == 0) {
        getLogger().info("Killed process with PID: " + std::to_string(pid));
        return true;
    }
    return false;
#endif
}

uint32_t ProcessUtils::killProcessByName(const std::string& processName) {
    auto pids = getProcessPids(processName);
    uint32_t killedCount = 0;
    
    for (uint32_t pid : pids) {
        if (killProcess(pid)) {
            killedCount++;
        }
    }
    
    if (killedCount > 0) {
        getLogger().info("Killed " + std::to_string(killedCount) + " instance(s) of " + processName);
    }
    
    return killedCount;
}

uint32_t ProcessUtils::killProcessByMultipleNames(const std::vector<std::string>& processNames) {
    uint32_t totalKilled = 0;
    
    for (const auto& processName : processNames) {
        totalKilled += killProcessByName(processName);
    }
    
    return totalKilled;
}

bool ProcessUtils::isAnyProcessRunning(const std::vector<std::string>& processNames) {
    for (const auto& processName : processNames) {
        if (isProcessRunning(processName)) {
            return true;
        }
    }
    return false;
}

bool ProcessUtils::waitForProcess(const std::string& processName, uint32_t timeoutMs) {
    auto startTime = std::chrono::steady_clock::now();
    auto timeout = std::chrono::milliseconds(timeoutMs);
    
    while (std::chrono::steady_clock::now() - startTime < timeout) {
        if (isProcessRunning(processName)) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
    
    return false;
}

uint32_t ProcessUtils::getProcessCountByDescription(const std::string& description) {
#ifdef _WIN32
    // For "League of Legends", use process name patterns (most reliable method)
    if (description == "League of Legends" || 
        description.find("league") != std::string::npos ||
        description.find("League") != std::string::npos) {
        
        // Method: Count League process components
        std::vector<std::string> leagueProcessNames = {
            "LeagueClient", "LeagueClientUx", "LeagueClientUxRender"
        };
        
        uint32_t totalCount = 0;
        for (const auto& procName : leagueProcessNames) {
            totalCount += static_cast<uint32_t>(getProcessPids(procName).size());
        }
        
        if (totalCount > 0) {
            return totalCount;
        }
    }
#endif
    return 0;
}

uint32_t ProcessUtils::killVgcProcess() {
#ifdef _WIN32
    // First, stop the VGC service using Windows Service Control API
    SC_HANDLE scManager = OpenSCManager(NULL, NULL, SC_MANAGER_CONNECT);
    if (scManager != NULL) {
        SC_HANDLE service = OpenServiceW(scManager, L"vgc", SERVICE_STOP | SERVICE_QUERY_STATUS);
        if (service != NULL) {
            getLogger().info("Stopping VGC service...");
            
            SERVICE_STATUS_PROCESS ssp;
            DWORD bytesNeeded;
            
            // Query current status
            if (QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, 
                (LPBYTE)&ssp, sizeof(SERVICE_STATUS_PROCESS), &bytesNeeded)) {
                
                // If service is running, stop it
                if (ssp.dwCurrentState != SERVICE_STOPPED) {
                    SERVICE_STATUS status;
                    if (ControlService(service, SERVICE_CONTROL_STOP, &status)) {
                        // Wait for service to stop (max 30 seconds)
                        DWORD waitTime = 0;
                        while (waitTime < 30000) {
                            if (!QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO,
                                (LPBYTE)&ssp, sizeof(SERVICE_STATUS_PROCESS), &bytesNeeded)) {
                                break;
                            }
                            
                            if (ssp.dwCurrentState == SERVICE_STOPPED) {
                                break;
                            }
                            
                            Sleep(500);
                            waitTime += 500;
                        }
                    }
                }
            }
            
            CloseServiceHandle(service);
            getLogger().info("VGC service stopped");
        }
        CloseServiceHandle(scManager);
    }
    
    // Then, kill VGC process using native API
    uint32_t killedCount = killProcessByName("vgc");
    if (killedCount > 0) {
        getLogger().info("VGC process terminated");
        std::this_thread::sleep_for(std::chrono::seconds(2));
        return 1;
    } else {
        // Process might already be terminated
        getLogger().info("VGC process not found (may already be terminated)");
        return 0;
    }
#else
    return 0;
#endif
}

bool ProcessUtils::checkVgcServiceExitCode185() {
#ifdef _WIN32
    SC_HANDLE scManager = OpenSCManager(NULL, NULL, SC_MANAGER_CONNECT);
    if (scManager == NULL) {
        return false;
    }
    
    SC_HANDLE service = OpenServiceW(scManager, L"vgc", SERVICE_QUERY_STATUS);
    if (service == NULL) {
        CloseServiceHandle(scManager);
        return false;
    }
    
    SERVICE_STATUS_PROCESS ssp;
    DWORD bytesNeeded;
    
    // Query service status including exit code
    if (QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO,
        (LPBYTE)&ssp, sizeof(SERVICE_STATUS_PROCESS), &bytesNeeded)) {
        
        // Check if service is stopped and has a service-specific exit code
        if (ssp.dwCurrentState == SERVICE_STOPPED) {
            // Check serviceSpecificExitCode (this is where exit code 185 would be stored)
            // If win32ExitCode is ERROR_SERVICE_SPECIFIC_ERROR, then dwServiceSpecificExitCode contains the error
            DWORD exitCode = ssp.dwServiceSpecificExitCode;
            
            CloseServiceHandle(service);
            CloseServiceHandle(scManager);
            
            if (ssp.dwWin32ExitCode == ERROR_SERVICE_SPECIFIC_ERROR && exitCode == 185) {
                getLogger().warn("VGC service exit code is 185 (0xb9) - service error detected");
                return true;
            }
        }
    }
    
    CloseServiceHandle(service);
    CloseServiceHandle(scManager);
    return false;
#else
    return false;
#endif
}

} // namespace league_monitor

