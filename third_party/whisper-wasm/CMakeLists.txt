#
# libmain
#

set(TARGET libmain)

add_executable(${TARGET}
    emscripten.cpp
    )

include(DefaultTargetOptions)

target_link_libraries(${TARGET} PRIVATE
    whisper
    )

message(STATUS "Building separate libmain.wasm + libmain.js")

target_compile_options(${TARGET} PRIVATE
    -O3
    -msimd128
    )

add_custom_command(
    TARGET ${TARGET} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/whisper.wasm
    COMMAND ${CMAKE_COMMAND} -E copy
        ${CMAKE_BINARY_DIR}/bin/libmain.js
        ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/whisper.wasm/main.js
    COMMAND ${CMAKE_COMMAND} -E copy
        ${CMAKE_BINARY_DIR}/bin/libmain.wasm
        ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/whisper.wasm/main.wasm
    )

set_target_properties(${TARGET} PROPERTIES LINK_FLAGS " \
    --bind \
    -O3 \
    -msimd128 \
    -flto=full \
    -s USE_PTHREADS=1 \
    -s PTHREAD_POOL_SIZE_STRICT=0 \
    -s PTHREAD_POOL_SIZE=8 \
    -s INITIAL_MEMORY=512MB \
    -s MAXIMUM_MEMORY=2000MB \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s FORCE_FILESYSTEM=1 \
    -s ENVIRONMENT=web,worker \
    -s TEXTDECODER=1 \
    -s EXPORTED_RUNTIME_METHODS=\"['print', 'printErr', 'ccall', 'cwrap', 'HEAPU8']\" \
    ")

#
# whisper.wasm
#

set(TARGET whisper.wasm)

configure_file(${CMAKE_CURRENT_SOURCE_DIR}/index-tmpl.html  ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/${TARGET}/index.html @ONLY)
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/../helpers.js    ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/${TARGET}/helpers.js @ONLY)
