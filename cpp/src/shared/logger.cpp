#include "shared/logger.h"
#include <sstream>
#include <iomanip>

namespace league_monitor {

Logger::Logger(const std::string& prefix) : prefix_(prefix) {
}

std::string Logger::getCurrentTimestamp() {
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;
    
    std::tm* localTime = std::localtime(&time);
    
    std::ostringstream oss;
    oss << std::put_time(localTime, "%m/%d/%Y, %H:%M:%S");
    oss << '.' << std::setfill('0') << std::setw(3) << ms.count();
    
    return oss.str();
}

std::string Logger::formatMessage(const std::string& level, const std::string& message) {
    std::ostringstream oss;
    oss << "[" << getCurrentTimestamp() << "] [" << prefix_ << "] [" << level << "] " << message;
    return oss.str();
}

void Logger::info(const std::string& message) {
    std::cout << formatMessage("INFO", message) << std::endl;
}

void Logger::warn(const std::string& message) {
    std::cerr << formatMessage("WARN", message) << std::endl;
}

void Logger::error(const std::string& message, const std::exception* error) {
    std::string fullMessage = message;
    if (error) {
        fullMessage += ": " + std::string(error->what());
    }
    std::cerr << formatMessage("ERROR", fullMessage) << std::endl;
}

void Logger::success(const std::string& message) {
    std::cout << formatMessage("SUCCESS", message) << std::endl;
}

} // namespace league_monitor

