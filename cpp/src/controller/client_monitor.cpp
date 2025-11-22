#include "controller/client_monitor.h"
#include "shared/logger.h"
#include "shared/process_utils.h"
#include "shared/league_utils.h"
#include <thread>
#include <chrono>
#include <atomic>

namespace league_monitor {

ClientMonitor::ClientMonitor(uint32_t monitorInterval)
    : logger_(std::make_unique<Logger>("ClientMonitor"))
    , monitorInterval_(monitorInterval)
    , lastRestartTime_(std::chrono::milliseconds(0))
    , lastLogTime_(std::chrono::milliseconds(0))
    , lastVgcCheckTime_(std::chrono::milliseconds(0)) {
}

ClientMonitor::~ClientMonitor() {
    stop();
}

void ClientMonitor::setImmediateStartCallback(ImmediateStartCallback callback) {
    onImmediateStart_ = callback;
}

void ClientMonitor::setRestartCallback(RestartCallback callback) {
    onRestart_ = callback;
}

void ClientMonitor::start() {
    if (isMonitoring_.load()) {
        logger_->warn("Monitor already running");
        return;
    }
    
    isMonitoring_ = true;
    logger_->info("Starting League Client monitor...");
    
    // Initial check and launch if needed
    checkAndRestartClient();
    
    // Start monitoring thread
    monitorThread_ = std::thread(&ClientMonitor::monitorLoop, this);
    
    logger_->success("Monitor started successfully");
}

void ClientMonitor::stop() {
    if (!isMonitoring_.load()) {
        return;
    }
    
    isMonitoring_ = false;
    
    if (monitorThread_.joinable()) {
        monitorThread_.join();
    }
    
    logger_->info("Monitor stopped");
}

void ClientMonitor::monitorLoop() {
    while (isMonitoring_.load()) {
        checkAndRestartClient();
        checkAndKillGame();
        checkLeagueProcessCount();
        checkVgcService();
        
        std::this_thread::sleep_for(std::chrono::milliseconds(monitorInterval_));
    }
}

void ClientMonitor::checkAndRestartClient() {
    std::string processName = LeagueUtils::getLeagueClientProcessName();
    
    // Check process count first - if already 1 or more, don't start new one
    auto processPids = ProcessUtils::getProcessPids(processName);
    uint32_t processCount = static_cast<uint32_t>(processPids.size());
    
    if (processCount >= 1) {
        // Already have LeagueClient running, don't start another one
        return;
    }
    
    // No LeagueClient running, check if we should restart
    bool isRunning = ProcessUtils::isProcessRunning(processName);
    
    if (!isRunning) {
        // Check cooldown - don't restart if we just restarted recently
        auto now = std::chrono::steady_clock::now();
        auto timeSinceLastRestart = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch() - lastRestartTime_);
        
        if (timeSinceLastRestart.count() < restartCooldown_) {
            uint32_t remainingSeconds = (restartCooldown_ - timeSinceLastRestart.count()) / 1000;
            logger_->info("LeagueClient not running, but in cooldown period (" + 
                         std::to_string(remainingSeconds) + "s remaining). Skipping restart.");
            return;
        }
        
        logger_->warn("LeagueClient is not running, restarting...");
        
        // Kill VGC process before restarting League Client (Windows only)
#ifdef _WIN32
        logger_->info("Terminating VGC process before restarting League Client...");
        ProcessUtils::killVgcProcess();
        std::this_thread::sleep_for(std::chrono::seconds(2));
#endif
        
        bool success = LeagueUtils::launchLeagueClient();
        
        if (success) {
            lastRestartTime_ = std::chrono::milliseconds(
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now().time_since_epoch()).count());
            logger_->success("LeagueClient restarted successfully");
            
            // Wait for process to actually appear (up to 15 seconds)
            logger_->info("Waiting for LeagueClient process to appear...");
            bool processAppeared = ProcessUtils::waitForProcess(processName, 15000);
            
            if (processAppeared) {
                logger_->success("LeagueClient process detected");
            } else {
                logger_->warn("LeagueClient process not detected after 15 seconds, but launch was successful");
            }
        } else {
            logger_->error("Failed to restart LeagueClient");
        }
    }
}

void ClientMonitor::checkAndKillGame() {
    auto gameProcessNames = LeagueUtils::getLeagueGameProcessNames();
    bool isGameRunning = ProcessUtils::isAnyProcessRunning(gameProcessNames);
    
    if (isGameRunning) {
        logger_->warn("League of Legends game process detected! Killing immediately...");
        uint32_t killedCount = ProcessUtils::killProcessByMultipleNames(gameProcessNames);
        
        if (killedCount > 0) {
            logger_->success("Killed " + std::to_string(killedCount) + " game process(es)");
        } else {
            logger_->warn("Failed to kill game process");
        }
    }
}

void ClientMonitor::checkLeagueProcessCount() {
#ifdef _WIN32
    try {
        uint32_t processCount = ProcessUtils::getProcessCountByDescription("League of Legends");
        
        // Always log process count for debugging (especially when >= 8)
        if (processCount != lastProcessCount_) {
            logger_->info("League of Legends process count: " + std::to_string(processCount));
            lastProcessCount_ = processCount;
        } else {
            // Log occasionally for lower counts
            auto now = std::chrono::steady_clock::now();
            auto timeSinceLastLog = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch() - lastLogTime_);
            
            if (lastLogTime_.count() == 0 || timeSinceLastLog.count() > 30000) {
                logger_->info("League of Legends process count: " + std::to_string(processCount));
                lastLogTime_ = std::chrono::milliseconds(
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        now.time_since_epoch()).count());
            }
        }
        
        // If exactly 8 or more processes and not already triggered, trigger immediate start
        if (processCount >= 8) {
            if (!immediateStartTriggered_.load()) {
                logger_->success(std::to_string(processCount) + " League of Legends processes detected (>=8)! Sending immediate start command to followers...");
                if (onImmediateStart_) {
                    onImmediateStart_();
                    immediateStartTriggered_ = true;
                } else {
                    logger_->warn("Process count >= 8 but onImmediateStart callback is not set!");
                }
            }
        }
        
        // Reset flag if process count drops below 8
        if (processCount < 8 && immediateStartTriggered_.load()) {
            logger_->info("League of Legends process count dropped to " + std::to_string(processCount) + " (below 8), resetting immediate start flag");
            immediateStartTriggered_ = false;
        }
    } catch (...) {
        // Log error for debugging
        logger_->error("Failed to check League of Legends process count");
    }
#endif
}

void ClientMonitor::checkVgcService() {
#ifdef _WIN32
    try {
        bool exitCode185 = ProcessUtils::checkVgcServiceExitCode185();
        if (exitCode185) {
            if (!vgcRestartTriggered_.load()) {
                logger_->warn("VGC service exit code 185 detected! Restarting League Client...");
                vgcRestartTriggered_ = true;
                
                ProcessUtils::killVgcProcess(); // Terminate VGC process
                
                std::string processName = LeagueUtils::getLeagueClientProcessName();
                bool isRunning = ProcessUtils::isProcessRunning(processName);
                
                if (isRunning) {
                    logger_->info("Killing existing League Client due to VGC exit code 185...");
                    ProcessUtils::killProcessByName(processName);
                    
                    // Also kill RiotClientServices
                    std::string riotClientServicesName = LeagueUtils::getRiotClientServicesProcessName();
                    bool riotClientServicesRunning = ProcessUtils::isProcessRunning(riotClientServicesName);
                    if (riotClientServicesRunning) {
                        logger_->info("Killing RiotClientServices...");
                        ProcessUtils::killProcessByName(riotClientServicesName);
                    }
                    
                    std::this_thread::sleep_for(std::chrono::seconds(2));
                }
                
                // Check cooldown
                auto now = std::chrono::steady_clock::now();
                auto timeSinceLastRestart = std::chrono::duration_cast<std::chrono::milliseconds>(
                    now.time_since_epoch() - lastRestartTime_);
                
                if (timeSinceLastRestart.count() < restartCooldown_) {
                    uint32_t remainingSeconds = (restartCooldown_ - timeSinceLastRestart.count()) / 1000;
                    logger_->info("VGC exit code 185 detected, but in cooldown period (" + 
                                 std::to_string(remainingSeconds) + "s remaining). Skipping restart.");
                    return;
                }
                
                // Restart League Client
                logger_->info("Restarting League Client due to VGC exit code 185...");
                bool success = LeagueUtils::launchLeagueClient();
                
                if (success) {
                    lastRestartTime_ = std::chrono::milliseconds(
                        std::chrono::duration_cast<std::chrono::milliseconds>(
                            now.time_since_epoch()).count());
                    logger_->success("League Client restarted successfully due to VGC exit code 185");
                    
                    logger_->info("Waiting for League Client process to appear...");
                    bool processAppeared = ProcessUtils::waitForProcess(processName, 15000);
                    if (processAppeared) {
                        logger_->success("League Client process detected");
                    } else {
                        logger_->warn("League Client process not detected after 15 seconds, but launch was successful");
                    }
                    
                    if (onRestart_) {
                        logger_->info("Notifying followers about restart due to VGC exit code 185...");
                        onRestart_();
                    } else {
                        logger_->warn("VGC exit code 185 detected but onRestart callback is not set!");
                    }
                } else {
                    logger_->error("Failed to restart League Client due to VGC exit code 185");
                }
            } else {
                auto now = std::chrono::steady_clock::now();
                auto timeSinceLastVgcCheck = std::chrono::duration_cast<std::chrono::milliseconds>(
                    now.time_since_epoch() - lastVgcCheckTime_);
                
                if (lastVgcCheckTime_.count() == 0 || timeSinceLastVgcCheck.count() > 30000) {
                    logger_->info("VGC service exit code 185 still detected (already triggered restart)");
                    lastVgcCheckTime_ = std::chrono::milliseconds(
                        std::chrono::duration_cast<std::chrono::milliseconds>(
                            now.time_since_epoch()).count());
                }
            }
        } else {
            if (vgcRestartTriggered_.load()) {
                logger_->info("VGC service exit code is no longer 185, resetting trigger flag");
                vgcRestartTriggered_ = false;
            }
        }
    } catch (...) {
        logger_->error("Failed to check VGC service");
    }
#endif
}

} // namespace league_monitor

