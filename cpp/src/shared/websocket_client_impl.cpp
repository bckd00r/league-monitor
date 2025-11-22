#include "shared/websocket_client_impl.h"
#include "shared/logger.h"
#include <thread>
#include <chrono>
#include <functional>

namespace league_monitor {

WebSocketClientImpl::WebSocketClientImpl(const std::string& serverUrl, Role role)
    : serverUrl_(serverUrl)
    , role_(role)
    , logger_(std::make_unique<Logger>("WebSocketClient")) {
    
    client_ = std::make_unique<ws_client>();
    client_->init_asio();
    
    // Set message handler
    client_->set_message_handler([this](connection_hdl hdl, ws_client::message_ptr msg) {
        std::string payload = msg->get_payload();
        this->handleMessage(payload);
    });
    
    // Set open handler
    client_->set_open_handler([this](connection_hdl hdl) {
        logger_->success("Connected to relay server");
        connected_ = true;
        shouldReconnect_ = false;
        connectionHandle_ = hdl;
        
        // Join or create session
        if (!sessionToken_.empty()) {
            joinSession(sessionToken_);
        } else {
            joinSession(); // Auto-join by IP
        }
    });
    
    // Set close handler
    client_->set_close_handler([this](connection_hdl hdl) {
        logger_->warn("Disconnected from relay server");
        connected_ = false;
        connectionHandle_ = connection_hdl();
        scheduleReconnect();
    });
    
    // Set fail handler
    client_->set_fail_handler([this](connection_hdl hdl) {
        logger_->error("Connection failed");
        connected_ = false;
        connectionHandle_ = connection_hdl();
        scheduleReconnect();
    });
}

WebSocketClientImpl::~WebSocketClientImpl() {
    disconnect();
}

bool WebSocketClientImpl::connect(const std::string& sessionToken) {
    if (!sessionToken.empty()) {
        sessionToken_ = sessionToken;
    }
    
    try {
        std::lock_guard<std::mutex> lock(mutex_);
        
        websocketpp::lib::error_code ec;
        ws_client::connection_ptr con = client_->get_connection(serverUrl_, ec);
        
        if (ec) {
            logger_->error("Connection creation failed: " + ec.message());
            return false;
        }
        
        client_->connect(con);
        
        // Start worker thread
        if (!workerThread_.joinable()) {
            shouldReconnect_ = true;
            workerThread_ = std::thread(&WebSocketClientImpl::run, this);
        }
        
        return true;
    } catch (const std::exception& e) {
        logger_->error("Connection exception: " + std::string(e.what()));
        return false;
    }
}

void WebSocketClientImpl::disconnect() {
    shouldReconnect_ = false;
    
    std::lock_guard<std::mutex> lock(mutex_);
    if (!connectionHandle_.expired()) {
        websocketpp::lib::error_code ec;
        client_->close(connectionHandle_, websocketpp::close::status::going_away, "", ec);
        connectionHandle_ = connection_hdl();
    }
    
    if (workerThread_.joinable()) {
        workerThread_.join();
    }
    
    connected_ = false;
}

void WebSocketClientImpl::run() {
    try {
        client_->run();
    } catch (const std::exception& e) {
        logger_->error("WebSocket run exception: " + std::string(e.what()));
    }
}

void WebSocketClientImpl::scheduleReconnect() {
    if (!shouldReconnect_) return;
    
    std::this_thread::sleep_for(std::chrono::seconds(5));
    
    if (shouldReconnect_ && !connected_) {
        logger_->info("Attempting to reconnect...");
        connect(sessionToken_);
    }
}

void WebSocketClientImpl::send(const nlohmann::json& data) {
    if (!connected_ || connectionHandle_.expired()) {
        return;
    }
    
    try {
        std::lock_guard<std::mutex> lock(mutex_);
        std::string payload = data.dump();
        
        websocketpp::lib::error_code ec;
        client_->send(connectionHandle_, payload, websocketpp::frame::opcode::text, ec);
        
        if (ec) {
            logger_->error("Send failed: " + ec.message());
        }
    } catch (const std::exception& e) {
        logger_->error("Send exception: " + std::string(e.what()));
    }
}

void WebSocketClientImpl::sendMessage(const std::string& type, const nlohmann::json& data) {
    nlohmann::json message;
    message["type"] = type;
    message["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    
    if (!data.empty()) {
        message.update(data);
    }
    
    if (!sessionToken_.empty()) {
        message["sessionToken"] = sessionToken_;
    }
    
    message["role"] = (role_ == Role::CONTROLLER) ? "controller" : "follower";
    
    send(message);
}

void WebSocketClientImpl::createSession() {
    sendMessage("CREATE_SESSION");
}

void WebSocketClientImpl::joinSession(const std::string& token) {
    nlohmann::json data;
    
    if (!token.empty()) {
        sessionToken_ = token;
        data["sessionToken"] = token;
    }
    
    sendMessage("JOIN", data);
}

void WebSocketClientImpl::handleMessage(const std::string& message) {
    try {
        nlohmann::json msg = nlohmann::json::parse(message);
        std::string type = msg.value("type", "");
        
        if (type == "STATUS_REQUEST") {
            if (statusCallback_) {
                auto [clientRunning, processCount] = statusCallback_();
                nlohmann::json data = {
                    {"clientRunning", clientRunning},
                    {"processCount", processCount}
                };
                sendMessage("STATUS_UPDATE", data);
            }
        } else if (type == "IMMEDIATE_START") {
            if (immediateStartCallback_) {
                immediateStartCallback_();
            }
        } else if (type == "CLIENT_RESTARTED") {
            if (clientRestartedCallback_) {
                clientRestartedCallback_();
            }
        } else if (type == "GAME_RUNNING_RESTART_REQUEST") {
            if (gameRunningRestartRequestCallback_) {
                gameRunningRestartRequestCallback_();
            }
        } else if (type == "SESSION_CREATED") {
            if (msg.contains("sessionToken")) {
                sessionToken_ = msg["sessionToken"].get<std::string>();
                logger_->success("Session created: " + sessionToken_);
            }
        } else if (type == "SESSION_JOINED") {
            logger_->success("Joined session successfully");
            // Request status if follower
            if (role_ == Role::FOLLOWER) {
                sendMessage("STATUS_REQUEST");
            }
        }
    } catch (const std::exception& e) {
        logger_->error("Failed to parse message: " + std::string(e.what()));
    }
}

} // namespace league_monitor

