#pragma once

#include <string>
#include <memory>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <chrono>
#include <ctime>

namespace league_monitor {

class Logger {
public:
    Logger(const std::string& prefix);
    
    void info(const std::string& message);
    void warn(const std::string& message);
    void error(const std::string& message, const std::exception* error = nullptr);
    void success(const std::string& message);

private:
    std::string prefix_;
    
    std::string formatMessage(const std::string& level, const std::string& message);
    std::string getCurrentTimestamp();
};

} // namespace league_monitor

