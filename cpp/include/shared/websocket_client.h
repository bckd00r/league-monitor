#pragma once

#include <string>
#include <functional>
#include <memory>
#include <thread>
#include <mutex>
#include <atomic>
#include "shared/types.h"

// Forward declarations for websocketpp
namespace websocketpp {
    template <typename config>
    class endpoint;
    template <typename config>
    class connection;
    using connection_hdl = std::weak_ptr<void>;
}

namespace league_monitor {

class Logger;

// PIMPL pattern to hide websocketpp implementation details
class WebSocketClientImpl;

class WebSocketClient {
public:
    using StatusCallback = std::function<std::pair<bool, uint32_t>()>; // Returns {clientRunning, processCount}
    
    WebSocketClient(const std::string& serverHost, uint16_t serverPort, Role role);
    ~WebSocketClient();
    
    // Delete copy constructor and assignment operator
    WebSocketClient(const WebSocketClient&) = delete;
    WebSocketClient& operator=(const WebSocketClient&) = delete;
    
    // Connection management
    bool connect(const std::string& sessionToken = "");
    void disconnect();
    bool isConnected() const;
    
    // Callbacks
    void setStatusRequestCallback(StatusCallback callback);
    void setImmediateStartCallback(std::function<void()> callback);
    void setClientRestartedCallback(std::function<void()> callback);
    void setGameRunningRestartRequestCallback(std::function<void()> callback);
    
    // Message sending
    void broadcastImmediateStart();
    void broadcastRestart();
    void requestRestartFromController();
    void sendStatus(bool clientRunning, uint32_t processCount = 0);

private:
    std::unique_ptr<WebSocketClientImpl> pImpl_;
    
    void sendMessage(const std::string& type, const std::string& data = "");
    void createSession();
    void joinSession(const std::string& token = "");
};

} // namespace league_monitor

