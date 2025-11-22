#include "controller/client_monitor.h"
#include "shared/websocket_client.h"
#include "shared/config.h"
#include "shared/logger.h"
#include "shared/process_utils.h"
#include "shared/league_utils.h"
#include <iostream>
#include <thread>
#include <chrono>

#ifdef _WIN32
#include <windows.h>
#endif

using namespace league_monitor;

int main(int argc, char* argv[]) {
    Logger logger("Controller");
    
    logger.info("Starting League Client Controller...");
    
#ifdef _WIN32
    logger.info("Platform: Windows");
#elif __APPLE__
    logger.info("Platform: macOS");
#else
    logger.info("Platform: Linux");
#endif
    
    // Load configuration
    Config& config = Config::getInstance();
    config.loadFromFile("config.json");
    
    ControllerConfig controllerConfig = config.getControllerConfig();
    
    // Initialize WebSocket client
    WebSocketClient sessionClient(
        controllerConfig.relayServerHost,
        controllerConfig.relayServerPort,
        Role::CONTROLLER
    );
    
    // Initialize client monitor
    ClientMonitor monitor(controllerConfig.monitorInterval);
    
    // Set callback to broadcast immediate start when 8+ processes detected
    monitor.setImmediateStartCallback([&sessionClient, &logger]() {
        logger.info("8+ League of Legends processes detected, sending immediate start command...");
        sessionClient.broadcastImmediateStart();
    });
    
    // Set callback to broadcast restart when VGC exit code 185 detected
    monitor.setRestartCallback([&sessionClient, &logger]() {
        logger.info("VGC exit code 185 detected. Waiting for process count to reach 8 before notifying followers...");
        
#ifdef _WIN32
        const uint32_t maxWaitTime = 120000; // 2 minutes
        const uint32_t checkInterval = 5000; // 5 seconds
        auto startTime = std::chrono::steady_clock::now();
        uint32_t processCount = 0;
        
        while (std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now() - startTime).count() < maxWaitTime) {
            try {
                processCount = ProcessUtils::getProcessCountByDescription("League of Legends");
                
                if (processCount >= 8) {
                    logger.success("VGC restart: Process count reached " + std::to_string(processCount) + " (>=8)! Notifying followers...");
                    sessionClient.broadcastRestart();
                    return;
                }
            } catch (...) {
                logger.warn("VGC restart: Failed to check process count");
            }
            
            std::this_thread::sleep_for(std::chrono::milliseconds(checkInterval));
        }
        
        logger.warn("VGC restart: Process count did not reach 8 within " + 
                   std::to_string(maxWaitTime / 1000) + " seconds. Current count: " + 
                   std::to_string(processCount) + ". Notifying followers anyway...");
        sessionClient.broadcastRestart();
#else
        logger.info("VGC exit code 185 detected, sending restart command to followers...");
        sessionClient.broadcastRestart();
#endif
    });
    
    // Set callback for game running restart request from follower
    sessionClient.setGameRunningRestartRequestCallback([&sessionClient, &logger]() {
        logger.info("Game running restart request received from follower! Restarting League Client...");
        
        // Kill VGC process before killing League Client
        ProcessUtils::killVgcProcess();
        std::this_thread::sleep_for(std::chrono::seconds(1));
        
        // Kill existing League Client if running
        std::string processName = LeagueUtils::getLeagueClientProcessName();
        bool isRunning = ProcessUtils::isProcessRunning(processName);
        
        if (isRunning) {
            logger.info("Killing existing League Client due to game running restart request...");
            ProcessUtils::killProcessByName(processName);
            
            // Also kill RiotClientServices
            std::string riotClientServicesName = LeagueUtils::getRiotClientServicesProcessName();
            bool riotClientServicesRunning = ProcessUtils::isProcessRunning(riotClientServicesName);
            if (riotClientServicesRunning) {
                logger.info("Killing RiotClientServices...");
                ProcessUtils::killProcessByName(riotClientServicesName);
            }
            
        }
        
        // Restart League Client
        bool success = LeagueUtils::launchLeagueClient();
        if (success) {
            logger.success("League Client restarted successfully due to game running restart request");
            
            // Wait for process to appear
            if (ProcessUtils::waitForProcess(processName, 15000)) {
                logger.success("League Client process detected");
            }
            
            // Wait for process count to reach 8 before notifying followers (Windows only)
#ifdef _WIN32
            logger.info("Waiting for process count to reach 8 before notifying followers...");
            
            const uint32_t maxWaitTime = 120000; // 2 minutes
            const uint32_t checkInterval = 5000; // 5 seconds
            auto startTime = std::chrono::steady_clock::now();
            uint32_t processCount = 0;
            
            while (std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::steady_clock::now() - startTime).count() < maxWaitTime) {
                try {
                    processCount = ProcessUtils::getProcessCountByDescription("League of Legends");
                    logger.info("Current process count: " + std::to_string(processCount) + " (waiting for >= 8)");
                    
                    if (processCount >= 8) {
                        logger.success("Process count reached " + std::to_string(processCount) + " (>=8)! Notifying followers...");
                        sessionClient.broadcastRestart();
                        return;
                    }
                } catch (...) {
                    logger.warn("Failed to check process count");
                }
                
                std::this_thread::sleep_for(std::chrono::milliseconds(checkInterval));
            }
            
            logger.warn("Process count did not reach 8 within " + 
                       std::to_string(maxWaitTime / 1000) + " seconds. Current count: " + 
                       std::to_string(processCount) + ". Notifying followers anyway...");
#endif
            sessionClient.broadcastRestart();
        }
    });
    
    // Set status request callback
    sessionClient.setStatusRequestCallback([]() -> std::pair<bool, uint32_t> {
        std::string processName = LeagueUtils::getLeagueClientProcessName();
        bool isRunning = ProcessUtils::isProcessRunning(processName);
        
        uint32_t processCount = 0;
#ifdef _WIN32
        processCount = ProcessUtils::getProcessCountByDescription("League of Legends");
#endif
        return {isRunning, processCount};
    });
    
    // Connect to relay server
    sessionClient.connect();
    
    // Start monitoring
    monitor.start();
    
    logger.success("Controller started successfully. Press Ctrl+C to exit.");
    
    // Keep running
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }
    
    return 0;
}

