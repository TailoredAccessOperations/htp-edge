# PixelMan — E8 lattice tooling.
#
#   make            build both binaries (release)
#   make test       build + run the endpoint/CLI verification suite
#   make sanitize   build with AddressSanitizer + UBSan
#   make pgo        profile-guided optimisation pass
#   make clean      remove build artefacts
#
# Both binaries share src/e8.c (the single source of mathematical truth);
# bin/e8_lattice is the CLI, bin/e8_http_server is the API daemon.

CC      ?= cc
CFLAGS  ?= -O3 -march=native -flto -std=c11 -Wall -Wextra -Wpedantic
LDLIBS   = -lm -pthread

BIN    := bin
OBJ    := build
CORE   := src/e8.c src/e8.h
SRV    := src/e8_http_server.c
CLI    := src/e8_lattice.c

.PHONY: all clean test sanitize pgo help

all: $(BIN)/e8_lattice $(BIN)/e8_http_server

$(BIN) $(OBJ):
	mkdir -p $@

$(OBJ)/e8.o: $(CORE) | $(OBJ)
	$(CC) $(CFLAGS) -c src/e8.c -o $@

$(OBJ)/e8_lattice.o: $(CLI) $(CORE) | $(OBJ)
	$(CC) $(CFLAGS) -c $(CLI) -o $@

$(OBJ)/e8_http_server.o: $(SRV) $(CORE) | $(OBJ)
	$(CC) $(CFLAGS) -c $(SRV) -o $@

$(BIN)/e8_lattice: $(OBJ)/e8_lattice.o $(OBJ)/e8.o | $(BIN)
	$(CC) $(CFLAGS) $^ -o $@ $(LDLIBS)

$(BIN)/e8_http_server: $(OBJ)/e8_http_server.o $(OBJ)/e8.o | $(BIN)
	$(CC) $(CFLAGS) $^ -o $@ $(LDLIBS)

# --- Verification --------------------------------------------------------

test: all
	@python3 scripts/test_e8.py
	@echo "PASS: CLI + HTTP verification suite"

# --- Debug builds ---------------------------------------------------------

sanitize: CFLAGS = -O1 -g -std=c11 -Wall -Wextra -Wpedantic \
                    -fsanitize=address,undefined -fno-omit-frame-pointer
sanitize: $(BIN)/e8_lattice $(BIN)/e8_http_server
	@echo "Built with AddressSanitizer + UBSan (run, then curl the endpoints)."

# --- Profile-guided optimisation ------------------------------------------

# Build with LLVM instrumentation, exercise the hot endpoints, merge the
# captured profiles and rebuild with them folded in. Throwaway scratch
# binaries and port keep this out of the way of any running servers.
PGO_BIN  := bin/.pgo
PG_TRAIN := pgo-train.profraw
PG_FINAL := pgo-train.profdata

pgo: | $(PGO_BIN)
	$(CC) -O3 -march=native -std=c11 -fprofile-instr-generate -pthread \
	    $(CLI) src/e8.c -o $(PGO_BIN)/e8_lattice -lm
	$(CC) -O3 -march=native -std=c11 -fprofile-instr-generate -pthread \
	    $(SRV) src/e8.c -o $(PGO_BIN)/e8_http_server -lm
	LLVM_PROFILE_FILE="$(PGO_BIN)/e8_lattice-%p.profraw" \
	    $(PGO_BIN)/e8_http_server 8099 & PID=$$!; \
	sleep 0.3; \
	for i in $$(seq 1 50); do \
	    curl -s "http://127.0.0.1:8099/api/roots"          > /dev/null; \
	    curl -s "http://127.0.0.1:8099/api/overlap"        > /dev/null; \
	    curl -s "http://127.0.0.1:8099/api/nearest?v=1,1"  > /dev/null; \
	    curl -s "http://127.0.0.1:8099/api/pixel/42"       > /dev/null; \
	done; \
	kill $$PID; wait $$PID 2>/dev/null || true
	xcrun llvm-profdata merge -sparse $(PGO_BIN)/*.profraw -o $(PG_FINAL)
	$(CC) -O3 -march=native -std=c11 -fprofile-instr-use=$(PG_FINAL) -pthread \
	    $(CLI) src/e8.c -o $(BIN)/e8_lattice -lm
	$(CC) -O3 -march=native -std=c11 -fprofile-instr-use=$(PG_FINAL) -pthread \
	    $(SRV) src/e8.c -o $(BIN)/e8_http_server -lm
	rm -rf $(PGO_BIN) $(PG_FINAL)
	@echo "PGO build complete."

$(PGO_BIN):
	mkdir -p $@

clean:
	rm -rf $(OBJ)
	rm -f $(BIN)/e8_lattice $(BIN)/e8_http_server
	rm -rf $(PGO_BIN)
	rm -f *.gcda *.gcno

help:
	@echo "Targets: all | test | sanitize | pgo | clean"