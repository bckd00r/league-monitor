#pragma once

#include <string>
#include <functional>
#include <memory>
#include <thread>
#include <mutex>
#include <atomic>
#include <websocketpp/config/asio_no_tls_client.hpp>
#include <websocketpp/client.hpp>
#include <nlohmann/json.hpp>
#include "shared/types.h"

namespace league_monitor {

class Logger;

// Internal implementation class for WebSocketClient
class WebSocketClientImpl {
public:
    using StatusCallback = std::function<std::pair<bool, uint32_t>()>;
    
    WebSocketClientImpl(const std::string& serverUrl, Role role);
    ~WebSocketClientImpl();
    
    bool connect(const std::string& sessionToken = "");
    void disconnect();
    bool isConnected() const { return connected_.load(); }
    
    void setStatusRequestCallback(StatusCallback callback) { statusCallback_ = callback; }
    void setImmediateStartCallback(std::function<void()> callback) { immediateStartCallback_ = callback; }
    void setClientRestartedCallback(std::function<void()> callback) { clientRestartedCallback_ = callback; }
    void setGameRunningRestartRequestCallback(std::function<void()> callback) { gameRunningRestartRequestCallback_ = callback; }
    
    void sendMessage(const std::string& type, const nlohmann::json& data = {});
    
    void createSession();
    void joinSession(const std::string& token = "");
    
private:
    typedef websocketpp::client<websocketpp::config::asio_no_tls_client> ws_client;
    typedef websocketpp::connection_hdl connection_hdl;
    
    std::string serverUrl_;
    std::string sessionToken_;
    Role role_;
    
    std::unique_ptr<ws_client> client_;
    connection_hdl connectionHandle_;
    
    std::atomic<bool> connected_{false};
    std::atomic<bool> shouldReconnect_{true};
    std::thread workerThread_;
    std::mutex mutex_;
    
    StatusCallback statusCallback_;
    std::function<void()> immediateStartCallback_;
    std::function<void()> clientRestartedCallback_;
    std::function<void()> gameRunningRestartRequestCallback_;
    
    std::unique_ptr<Logger> logger_;
    
    void handleMessage(const std::string& message);
    void scheduleReconnect();
    void run();
    void send(const nlohmann::json& data);
};

} // namespace league_monitor

