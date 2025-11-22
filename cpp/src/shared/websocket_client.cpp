#include "shared/websocket_client.h"
#include "shared/websocket_client_impl.h"

namespace league_monitor {

WebSocketClient::WebSocketClient(const std::string& serverHost, uint16_t serverPort, Role role)
    : pImpl_(std::make_unique<WebSocketClientImpl>("ws://" + serverHost + ":" + std::to_string(serverPort), role)) {
}

WebSocketClient::~WebSocketClient() = default;

bool WebSocketClient::connect(const std::string& sessionToken) {
    return pImpl_->connect(sessionToken);
}

void WebSocketClient::disconnect() {
    pImpl_->disconnect();
}

bool WebSocketClient::isConnected() const {
    return pImpl_->isConnected();
}

void WebSocketClient::setStatusRequestCallback(StatusCallback callback) {
    pImpl_->setStatusRequestCallback(callback);
}

void WebSocketClient::setImmediateStartCallback(std::function<void()> callback) {
    pImpl_->setImmediateStartCallback(callback);
}

void WebSocketClient::setClientRestartedCallback(std::function<void()> callback) {
    pImpl_->setClientRestartedCallback(callback);
}

void WebSocketClient::setGameRunningRestartRequestCallback(std::function<void()> callback) {
    pImpl_->setGameRunningRestartRequestCallback(callback);
}

void WebSocketClient::sendMessage(const std::string& type, const std::string& data) {
    nlohmann::json jsonData;
    if (!data.empty()) {
        try {
            jsonData = nlohmann::json::parse(data);
        } catch (...) {
            // If data is not JSON, ignore
        }
    }
    pImpl_->sendMessage(type, jsonData);
}

void WebSocketClient::broadcastImmediateStart() {
    pImpl_->sendMessage("IMMEDIATE_START");
}

void WebSocketClient::broadcastRestart() {
    pImpl_->sendMessage("CLIENT_RESTARTED");
}

void WebSocketClient::requestRestartFromController() {
    pImpl_->sendMessage("GAME_RUNNING_RESTART_REQUEST");
}

void WebSocketClient::sendStatus(bool clientRunning, uint32_t processCount) {
    nlohmann::json data = {
        {"clientRunning", clientRunning},
        {"processCount", processCount}
    };
    pImpl_->sendMessage("STATUS_UPDATE", data);
}

void WebSocketClient::createSession() {
    pImpl_->createSession();
}

void WebSocketClient::joinSession(const std::string& token) {
    pImpl_->joinSession(token);
}

} // namespace league_monitor
