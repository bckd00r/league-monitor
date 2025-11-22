cmake_minimum_required(VERSION 3.15)
project(LeagueMonitor VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Platform detection
if(WIN32)
    add_definitions(-D_WIN32_WINNT=0x0601)
    set(PLATFORM_WINDOWS ON)
elseif(APPLE)
    set(PLATFORM_MACOS ON)
elseif(UNIX)
    set(PLATFORM_LINUX ON)
endif()

# Build type
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# Output directories
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

# Include directories
include_directories(
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_SOURCE_DIR}/lib
)

# FetchContent module
include(FetchContent)

# ========================================
# nlohmann/json (header-only)
# ========================================
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.2
)
FetchContent_GetProperties(json)
if(NOT json_POPULATED)
    FetchContent_Populate(json)
    add_library(nlohmann_json INTERFACE)
    target_include_directories(nlohmann_json INTERFACE ${json_SOURCE_DIR}/single_include)
    add_library(nlohmann_json::nlohmann_json ALIAS nlohmann_json)
endif()

# ========================================
# Boost (REQUIRED by websocketpp 0.8.2)
# ========================================
# First try to find system Boost
find_package(Boost 1.65.0 QUIET COMPONENTS system thread)

if(NOT Boost_FOUND)
    message(STATUS "System Boost not found. Downloading Boost headers via FetchContent...")
    
    # Download Boost headers (lightweight, no full build)
    # Using correct hash for 1.82.0 tar.gz from GitHub
    FetchContent_Declare(
        boost
        URL https://github.com/boostorg/boost/releases/download/boost-1.82.0/boost-1.82.0.tar.gz
        URL_HASH SHA256=b62bd839ea6c28265af9a1f68393eda37fab3611425d3b28882d8e424535ec9d
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    
    FetchContent_GetProperties(boost)
    if(NOT boost_POPULATED)
        FetchContent_Populate(boost)
        
        # Create interface library for Boost headers
        add_library(boost_headers INTERFACE)
        target_include_directories(boost_headers INTERFACE ${boost_SOURCE_DIR})
        
        # Create aliases to match find_package behavior
        add_library(Boost::boost ALIAS boost_headers)
        add_library(Boost::system ALIAS boost_headers)
        add_library(Boost::thread ALIAS boost_headers)
        
        set(Boost_FOUND TRUE)
        set(Boost_INCLUDE_DIRS ${boost_SOURCE_DIR})
    endif()
else()
    message(STATUS "Using system Boost: ${Boost_VERSION}")
endif()

# ========================================
# websocketpp (header-only)
# ========================================
FetchContent_Declare(
    websocketpp
    GIT_REPOSITORY https://github.com/zaphoyd/websocketpp.git
    GIT_TAG 0.8.2
)
FetchContent_GetProperties(websocketpp)
if(NOT websocketpp_POPULATED)
    FetchContent_Populate(websocketpp)
    
    # Create interface library for websocketpp
    add_library(websocketpp INTERFACE)
    target_include_directories(websocketpp INTERFACE ${websocketpp_SOURCE_DIR})
    
    # Link Boost (now guaranteed to exist)
    target_link_libraries(websocketpp INTERFACE Boost::boost)
    
    # Define ASIO_STANDALONE=0 to use Boost.Asio
    target_compile_definitions(websocketpp INTERFACE ASIO_STANDALONE=0)
endif()

# ========================================
# yaml-cpp
# ========================================
FetchContent_Declare(
    yaml_cpp
    GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
    GIT_TAG 0.8.0
)
FetchContent_GetProperties(yaml_cpp)
if(NOT yaml_cpp_POPULATED)
    FetchContent_Populate(yaml_cpp)
    
    # Patch CMakeLists.txt to lower CMake requirement
    file(READ ${yaml_cpp_SOURCE_DIR}/CMakeLists.txt YAML_CPP_CMAKE_CONTENT)
    string(REGEX REPLACE 
        "cmake_minimum_required\\(VERSION [0-9]+\\.[0-9]+\\)" 
        "cmake_minimum_required(VERSION 3.5)" 
        YAML_CPP_CMAKE_CONTENT 
        "${YAML_CPP_CMAKE_CONTENT}")
    file(WRITE ${yaml_cpp_SOURCE_DIR}/CMakeLists.txt "${YAML_CPP_CMAKE_CONTENT}")
    
    add_subdirectory(${yaml_cpp_SOURCE_DIR} ${yaml_cpp_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()

# ========================================
# Find optional packages
# ========================================
find_package(Threads REQUIRED)
find_package(OpenSSL QUIET)

# ========================================
# Shared library
# ========================================
add_library(shared_lib
    src/shared/logger.cpp
    src/shared/config.cpp
    src/shared/process_utils.cpp
    src/shared/league_utils.cpp
    src/shared/websocket_client.cpp
    src/shared/websocket_client_impl.cpp
)

target_include_directories(shared_lib
    PUBLIC
        ${CMAKE_SOURCE_DIR}/include
    PRIVATE
        ${CMAKE_SOURCE_DIR}/src
)

# WebSocketpp + Boost configuration
target_compile_definitions(shared_lib
    PRIVATE
        _WEBSOCKETPP_CPP11_RANDOM_DEVICE_
        _WEBSOCKETPP_CPP11_TYPE_TRAITS_
        ASIO_STANDALONE=0
)

target_link_libraries(shared_lib
    PRIVATE
        nlohmann_json::nlohmann_json
        websocketpp
        Boost::boost
        yaml-cpp
        Threads::Threads
)

# Platform-specific libraries
if(WIN32)
    target_link_libraries(shared_lib PRIVATE ws2_32 advapi32)
else()
    if(OpenSSL_FOUND)
        target_link_libraries(shared_lib PRIVATE OpenSSL::SSL OpenSSL::Crypto)
    endif()
endif()

# ========================================
# Controller executable
# ========================================
add_executable(controller
    src/controller/main.cpp
    src/controller/client_monitor.cpp
)

target_link_libraries(controller PRIVATE shared_lib)

if(WIN32)
    target_link_libraries(controller PRIVATE ws2_32 advapi32)
else()
    target_link_libraries(controller PRIVATE Threads::Threads)
endif()

# ========================================
# Follower executable
# ========================================
add_executable(follower
    src/client/main.cpp
)

target_link_libraries(follower PRIVATE shared_lib)

if(WIN32)
    target_link_libraries(follower PRIVATE ws2_32 advapi32)
else()
    target_link_libraries(follower PRIVATE Threads::Threads)
endif()

# ========================================
# Installation
# ========================================
install(TARGETS controller follower
    RUNTIME DESTINATION bin
)

install(DIRECTORY include/
    DESTINATION include
    FILES_MATCHING PATTERN "*.h"
)