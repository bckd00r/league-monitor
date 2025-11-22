#pragma once

#include <functional>
#include <memory>
#include <thread>
#include <atomic>
#include <chrono>
#include <cstdint>

namespace league_monitor {

class Logger;
class ProcessUtils;

class ClientMonitor {
public:
    using ImmediateStartCallback = std::function<void()>;
    using RestartCallback = std::function<void()>;
    
    ClientMonitor(uint32_t monitorInterval = 5000);
    ~ClientMonitor();
    
    void setImmediateStartCallback(ImmediateStartCallback callback);
    void setRestartCallback(RestartCallback callback);
    
    void start();
    void stop();
    
private:
    std::unique_ptr<Logger> logger_;
    uint32_t monitorInterval_;
    std::atomic<bool> isMonitoring_{false};
    std::thread monitorThread_;
    
    // Callbacks
    ImmediateStartCallback onImmediateStart_;
    RestartCallback onRestart_;
    
    // State tracking
    uint32_t lastProcessCount_{0};
    std::atomic<bool> immediateStartTriggered_{false};
    std::chrono::milliseconds lastRestartTime_{0};
    std::chrono::milliseconds lastLogTime_{0};
    std::chrono::milliseconds lastVgcCheckTime_{0};
    std::atomic<bool> vgcRestartTriggered_{false};
    const uint32_t restartCooldown_{30000}; // 30 seconds
    
    void monitorLoop();
    void checkAndRestartClient();
    void checkAndKillGame();
    void checkLeagueProcessCount();
    void checkVgcService();
};

} // namespace league_monitor

