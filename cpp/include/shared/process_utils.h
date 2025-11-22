#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <memory>

namespace league_monitor {

class Logger;

class ProcessUtils {
public:
    // Check if a process is running by name
    static bool isProcessRunning(const std::string& processName);
    
    // Get all PIDs for a process name
    static std::vector<uint32_t> getProcessPids(const std::string& processName);
    
    // Kill a process by PID
    static bool killProcess(uint32_t pid);
    
    // Kill process by name
    static uint32_t killProcessByName(const std::string& processName);
    
    // Kill process by multiple names
    static uint32_t killProcessByMultipleNames(const std::vector<std::string>& processNames);
    
    // Check if any of the processes are running
    static bool isAnyProcessRunning(const std::vector<std::string>& processNames);
    
    // Wait for process to appear
    static bool waitForProcess(const std::string& processName, uint32_t timeoutMs = 5000);
    
    // Get process count by description (Windows-specific, for League of Legends)
    static uint32_t getProcessCountByDescription(const std::string& description);
    
    // Kill VGC process (Windows only)
    static uint32_t killVgcProcess();
    
    // Check VGC service exit code 185
    static bool checkVgcServiceExitCode185();

private:
    static std::unique_ptr<Logger> logger_;
    static Logger& getLogger();
};

} // namespace league_monitor

