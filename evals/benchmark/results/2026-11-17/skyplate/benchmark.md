# Skyplate benchmark

This page is `benchmark.json` laid out for reading: every value in that file is on this page,
and nothing here is missing from it. It holds numbers, true/false, and words from Skyplate's
own vocabulary (its phases, tools, codes and language names). It holds no path, file name,
identifier, code, author, commit, branch, remote, package name or date.

- Counts and sizes are rounded up to a power of two.
- Durations (`ms`, `totalMs`) are in milliseconds, to two significant figures.
- Shares (`rates`, `unresolvedShare`) are fractions of 1, to the nearest hundredth.
- Versions, schema constants, source positions in Skyplate's own files and skeleton ids are exact.

A reader can still tell roughly how large the project is and which languages it uses.
The `skeleton` section also keeps the exact shape of the directory tree and the import graph, as anonymous ids.
Nothing was sent anywhere; sharing this file is your decision.

- format: skyplate-benchmark
- version: 1

## privacy

- level: skeleton
- coarsening: power-of-two
- durations: two-significant-figures
- ratios: hundredths
- retainsShape: true

## environment

- skyplate: 0.2.0
- reportSchema: 2
- bun: 1.4.4
- platform: darwin
- architecture: arm64
- cores: 16
- memoryBytes: 34359738368

## options

| code | value |
| --- | --- |
| includeIgnored | 0 |
| git | 1 |
| source | 1 |
| symbols | 1 |
| layout | 1 |
| maxCommits | 32768 |
| maxSourceFile | 524288 |
| maxSourceTotal | 67108864 |
| tsMaxFiles | 32768 |
| tsMaxRefs | 1048576 |
| redactPaths | 0 |
| maxReadBytes | 8388608 |
| workers | 2 |
| exclude_count | 0 |

## scale


### totals

| code | value |
| --- | --- |
| files | 512 |
| dirs | 128 |
| bytes | 16777216 |
| lines | 262144 |
| code | 262144 |
| comment | 16384 |
| blank | 8192 |
| binaryFiles | 8 |
| generatedFiles | 8 |
| vendoredFiles | 16 |
| ignored | 16 |
| languages | 32 |
| secrets | 0 |

### languages

| language | totals | diagnostics |
| --- | --- | --- |
| astro | files 1 · bytes 64 · lines 4 · code 4 · comment 0 · blank 0 | extension 1 |
| binary | files 8 · bytes 524288 · lines 0 · code 0 · comment 0 · blank 0 | content 8 |
| css | files 2 · bytes 16384 · lines 512 · code 256 · comment 128 · blank 32 | extension 2 |
| html | files 8 · bytes 131072 · lines 1024 · code 1024 · comment 32 · blank 4 | heuristic 8 |
| ignore-list | files 2 · bytes 2048 · lines 64 · code 64 · comment 16 · blank 16 | filename 2 |
| javascript | files 8 · bytes 1024 · lines 32 · code 16 · comment 16 · blank 2 | extension 8 |
| json | files 128 · bytes 4194304 · lines 262144 · code 262144 · comment 0 · blank 512 | heuristic 128 · filename 2 |
| json-with-comments | files 16 · bytes 4096 · lines 64 · code 64 · comment 8 · blank 8 | filename 16 |
| markdown | files 32 · bytes 1048576 · lines 32768 · code 32768 · comment 4 · blank 2048 | heuristic 32 |
| python | files 8 · bytes 32768 · lines 512 · code 512 · comment 8 · blank 64 | extension 8 |
| svelte | files 2 · bytes 256 · lines 2 · code 2 · comment 0 · blank 0 | extension 2 |
| svg | files 4 · bytes 16384 · lines 16 · code 16 · comment 2 · blank 0 | extension 4 |
| text | files 32 · bytes 262144 · lines 4096 · code 4096 · comment 0 · blank 512 | filename 2 · fallback 32 · heuristic 16 |
| toml | files 1 · bytes 256 · lines 16 · code 8 · comment 4 · blank 4 | extension 1 |
| tsx | files 128 · bytes 1048576 · lines 16384 · code 16384 · comment 2048 · blank 1024 | heuristic 128 |
| typescript | files 256 · bytes 4194304 · lines 65536 · code 65536 · comment 8192 · blank 4096 | heuristic 256 · extension 1 |
| vue | files 4 · bytes 512 · lines 4 · code 4 · comment 0 · blank 0 | extension 4 |
| yaml | files 4 · bytes 4096 · lines 64 · code 64 · comment 16 · blank 4 | heuristic 4 |

### categories

| category | totals |
| --- | --- |
| code | files 512 · bytes 4194304 · lines 65536 |
| data | files 128 · bytes 4194304 · lines 262144 |
| test | files 64 · bytes 524288 · lines 16384 |
| docs | files 64 · bytes 1048576 · lines 32768 |
| config | files 32 · bytes 65536 · lines 2048 |
| unknown | files 32 · bytes 131072 · lines 2048 |
| markup | files 8 · bytes 131072 · lines 1024 |
| archive | files 8 · bytes 524288 · lines 0 |
| image | files 4 · bytes 16384 · lines 16 |
| lockfile | files 2 · bytes 131072 · lines 1024 |
| style | files 2 · bytes 16384 · lines 512 |
| build | files 1 · bytes 4096 · lines 64 |

### distributions

| metric | count | minimum | p50 | p90 | p99 | maximum | histogram |
| --- | --- | --- | --- | --- | --- | --- | --- |
| file_bytes | 512 | 16 | 8192 | 65536 | 524288 | 1048576 | ≤16: 1 · ≤32: 4 · ≤64: 32 · ≤128: 32 · ≤256: 32 · ≤512: 32 · ≤1024: 64 · ≤2048: 64 · ≤4096: 128 · ≤8192: 128 · ≤16384: 128 · ≤32768: 64 · ≤65536: 32 · ≤131072: 16 · ≤262144: 2 · ≤524288: 8 · ≤1048576: 1 |
| file_lines | 512 | 0 | 128 | 1024 | 8192 | 32768 | ≤0: 8 · ≤1: 64 · ≤2: 8 · ≤4: 16 · ≤8: 16 · ≤16: 16 · ≤32: 64 · ≤64: 64 · ≤128: 128 · ≤256: 128 · ≤512: 128 · ≤1024: 64 · ≤2048: 32 · ≤4096: 8 · ≤8192: 8 · ≤16384: 4 · ≤32768: 2 |
| file_depth | 512 | 0 | 4 | 4 | 8 | 8 | ≤0: 32 · ≤1: 64 · ≤2: 128 · ≤4: 512 · ≤8: 64 |
| directory_fanout | 128 | 1 | 4 | 16 | 64 | 64 | ≤1: 32 · ≤2: 32 · ≤4: 32 · ≤8: 16 · ≤16: 8 · ≤32: 8 · ≤64: 4 |
| fanIn | 512 | 0 | 0 | 8 | 32 | 128 | ≤0: 512 · ≤1: 128 · ≤2: 64 · ≤4: 64 · ≤8: 32 · ≤16: 32 · ≤32: 4 · ≤64: 4 · ≤128: 1 |
| fanOut | 512 | 0 | 0 | 8 | 32 | 32 | ≤0: 512 · ≤1: 128 · ≤2: 64 · ≤4: 64 · ≤8: 64 · ≤16: 32 · ≤32: 16 |
| symbols_per_file | 512 | 0 | 2 | 32 | 256 | 512 | ≤0: 256 · ≤1: 16 · ≤2: 64 · ≤4: 64 · ≤8: 64 · ≤16: 128 · ≤32: 64 · ≤64: 32 · ≤128: 16 · ≤256: 8 · ≤512: 1 |
| references_per_symbol | 8192 | 0 | 4 | 16 | 64 | 4096 | ≤0: 512 · ≤1: 2048 · ≤2: 1024 · ≤4: 2048 · ≤8: 1024 · ≤16: 1024 · ≤32: 256 · ≤64: 128 · ≤128: 32 · ≤256: 16 · ≤512: 4 · ≤4096: 1 |
| commits_per_file | 512 | 0 | 1 | 4 | 8 | 16 | ≤0: 256 · ≤1: 128 · ≤2: 128 · ≤4: 128 · ≤8: 32 · ≤16: 2 |
| authors_per_file | 512 | 0 | 1 | 1 | 1 | 1 | ≤0: 256 · ≤1: 512 |
| age_days | 512 | 0.001953125 | 32 | 32 | 32 | 32 | ≤0.001953125: 8 · ≤0.0078125: 32 · ≤16: 64 · ≤32: 256 |
| cycle_size | 1 | 4 | 4 | 4 | 4 | 4 | ≤4: 1 |

## cost

- totalMs: 2100
- samplingMs: 100

### phases

| phase | status | ms | filesPerSecond | bytesPerSecond |
| --- | --- | --- | --- | --- |
| walk | ok | 17 | 32768 | 536870912 |
| detect | ok | 75 | 8192 | 134217728 |
| git | ok | 310 | 2048 | 33554432 |
| files | ok | 320 | 2048 | 33554432 |
| imports | ok | 11 | 65536 | 1073741824 |
| graph | ok | 4 | 131072 | 2147483648 |
| layout | ok | 320 | 2048 | 33554432 |
| typescript | ok | 1900 | 512 | 8388608 |
| stats | ok | 1 | 524288 | 8589934592 |
| findings | ok | 3 | 262144 | 4294967296 |

### memory

| phase | status | rss | heap |
| --- | --- | --- | --- |
| walk | start | 33554432 | 8388608 |
| walk | done | 33554432 | 8388608 |
| detect | start | 33554432 | 8388608 |
| detect | done | 67108864 | 8388608 |
| git | start | 67108864 | 8388608 |
| typescript | start | 67108864 | 8388608 |
| files | start | 67108864 | 8388608 |
| git | done | 134217728 | 33554432 |
| files | done | 268435456 | 33554432 |
| imports | start | 268435456 | 33554432 |
| imports | done | 268435456 | 33554432 |
| graph | start | 268435456 | 33554432 |
| graph | done | 268435456 | 33554432 |
| layout | start | 268435456 | 33554432 |
| layout | done | 268435456 | 134217728 |
| typescript | done | 268435456 | 268435456 |
| stats | start | 268435456 | 268435456 |
| stats | done | 268435456 | 268435456 |
| findings | start | 268435456 | 268435456 |
| findings | done | 268435456 | 268435456 |

### totals

| code | value |
| --- | --- |
| peak_rss | 536870912 |
| peak_heap | 268435456 |
| high_water_rss | 536870912 |

### workers

| code | value |
| --- | --- |
| size | 2 |
| submitted | 64 |
| completed | 64 |
| failed | 0 |
| spawned | 2 |
| queuePeak | 16 |
| busyPeak | 2 |
| waitMs | 4096 |
| runMs | 2048 |

### payloads

| code | value |
| --- | --- |
| report | 524288 |
| symbols_payload | 2097152 |
| source_chunk | 2097152 |
| source_chunk | 2097152 |
| source_chunk | 2097152 |
| source_chunk | 2097152 |
| source_chunk | 2097152 |
| assets | 16384 |

### layout

| ms | budgetMs | siblingBudgetMs | exceeded |
| --- | --- | --- | --- |
| 3.3 | 150 | 0 | false |

## quality

- errors: none
- validation: none

### imports

| language | internal | external | unresolved | unresolvedShare | shapes |
| --- | --- | --- | --- | --- | --- |
| typescript | 512 | 256 | 4 | 0 | relative 4 |
| python | 0 | 32 | 0 | 0 | none |
| svelte | 2 | 0 | 0 | 0 | none |
| vue | 4 | 0 | 0 | 0 | none |
| astro | 1 | 0 | 0 | 0 | none |
| javascript | 4 | 0 | 0 | 0 | none |
| tsx | 512 | 256 | 0 | 0 | none |
| css | 1 | 2 | 0 | 0 | none |

### rates

| code | value |
| --- | --- |
| ts_coverage | 1 |
| ts_unresolved_share | 0.03 |
| unused_export_share | 0.24 |

### typescript

| code | value |
| --- | --- |
| present | 512 |
| eligible | 512 |
| covered | 512 |
| projects | 8 |
| references | 65536 |
| symbols | 8192 |
| unresolved | 2048 |
| uninstalledManifests | 0 |
| hostFiles | 8 |

### unusedExports

| code | value |
| --- | --- |
| exports | 2048 |
| unusedExports | 512 |
| used-in-own-file | 256 |
| unreferenced | 128 |
| public-api | 1 |
| entry-export | 8 |

### entryPoints

| code | value |
| --- | --- |
| package bin | 1 |
| package script | 2 |
| type declarations | 4 |
| package exports | 1 |

### cycles

| code | value |
| --- | --- |
| runtime_cycles | 1 |
| type_cycles | 4 |

### diagnostics

| code | value |
| --- | --- |
| warnings_total | 0 |
| ts_config_base | 1 |
| ts_config_solution | 1 |

## limits

| code | value |
| --- | --- |
| rust_use_cap | 0 |
| rust_statement_cap | 0 |
| pagerank_iteration_cap | 0 |
| module_split_cap | 0 |
| git_coupling_cap | 0 |
| git_sweep_threshold | 64 |
| git_sweep_commits | 4 |
| asset_size_cap | 0 |
| source_secret_disabled | 0 |
| source_binary_disabled | 8 |
| symbols_disabled | 0 |
| git_disabled | 0 |
| text_read_cap | 0 |
| binary_read_cap | 0 |
| ts_file_cap | 0 |
| ts_reference_cap | 0 |
| package_sibling_cap | 0 |
| git_rename_limit | 0 |
| git_move_limit | 0 |
| shallow | 0 |
| truncated | 0 |
| analyzedCommits | 32 |
| totalCommits | 32 |
| source_file_cap | 1 |
| source_total_cap | 0 |
| source_disabled | 0 |

## queries

| tool | rank | status | ms | responseBytes | tokens | truncated | error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| overview | cold | ok | 0.43 | 4096 | 1024 | 0 | none |
| map_codebase | cold | ok | 5 | 8192 | 2048 | 0 | none |
| locate_code | top_hotspot | ok | 3.3 | 4096 | 1024 | 0 | none |
| change_impact | top_hotspot | ok | 3.7 | 4096 | 1024 | 0 | none |
| change_impact | most_referenced | ok | 0.29 | 1024 | 256 | 0 | none |
| files | top_hotspot | ok | 0.39 | 16384 | 4096 | 512 | none |
| dir | largest_directory | ok | 0.27 | 2048 | 512 | 0 | none |
| dir | median_directory | ok | 0.029 | 1024 | 256 | 0 | none |
| file | top_hotspot | ok | 0.33 | 8192 | 2048 | 0 | none |
| file | median_file | ok | 0.052 | 4096 | 1024 | 0 | none |
| symbol | most_referenced | ok | 0.47 | 2048 | 512 | 4096 | none |
| search_symbols | most_referenced | ok | 0.73 | 4096 | 1024 | 0 | none |
| seams | cold | ok | 5 | 16384 | 4096 | 0 | none |
| seam | largest_directory | ok | 3 | 8192 | 2048 | 64 | none |
| seam | median_directory | ok | 1.7 | 2048 | 512 | 0 | none |
| graph | top_hotspot | ok | 0.17 | 1024 | 256 | 0 | none |
| history | cold | ok | 0.16 | 512 | 128 | 0 | none |
| dependencies | cold | ok | 0.11 | 8192 | 2048 | 32 | none |
| overview | warm | ok | 0.19 | 4096 | 1024 | 0 | none |

## anomalies

None.

## failures

None.

## session

- calls: none
- transitions: none

## skeleton


### dirs

| id | parent |
| --- | --- |
| 0 | 18 |
| 1 | 53 |
| 2 | -1 |
| 3 | 89 |
| 4 | 72 |
| 5 | 3 |
| 6 | 8 |
| 7 | 98 |
| 8 | 45 |
| 9 | 45 |
| 10 | 90 |
| 11 | 8 |
| 12 | 77 |
| 13 | 77 |
| 14 | 73 |
| 15 | 43 |
| 16 | 98 |
| 17 | 8 |
| 18 | 2 |
| 19 | 98 |
| 20 | 93 |
| 21 | 72 |
| 22 | 86 |
| 23 | 74 |
| 24 | 72 |
| 25 | 28 |
| 26 | 3 |
| 27 | 80 |
| 28 | 84 |
| 29 | 2 |
| 30 | 22 |
| 31 | 5 |
| 32 | 90 |
| 33 | 44 |
| 34 | 32 |
| 35 | 53 |
| 36 | 32 |
| 37 | 90 |
| 38 | 2 |
| 39 | 98 |
| 40 | 3 |
| 41 | 66 |
| 42 | 72 |
| 43 | 60 |
| 44 | 84 |
| 45 | 90 |
| 46 | 58 |
| 47 | 23 |
| 48 | 89 |
| 49 | 43 |
| 50 | 87 |
| 51 | 2 |
| 52 | 89 |
| 53 | 8 |
| 54 | 3 |
| 55 | 56 |
| 56 | 2 |
| 57 | 38 |
| 58 | 65 |
| 59 | 89 |
| 60 | 10 |
| 61 | 80 |
| 62 | 92 |
| 63 | 3 |
| 64 | 98 |
| 65 | 2 |
| 66 | 90 |
| 67 | 38 |
| 68 | 77 |
| 69 | 65 |
| 70 | 36 |
| 71 | 20 |
| 72 | 89 |
| 73 | 3 |
| 74 | 29 |
| 75 | 8 |
| 76 | 75 |
| 77 | 3 |
| 78 | 8 |
| 79 | 43 |
| 80 | 74 |
| 81 | 30 |
| 82 | 3 |
| 83 | 8 |
| 84 | 78 |
| 85 | 22 |
| 86 | 8 |
| 87 | 74 |
| 88 | 102 |
| 89 | 2 |
| 90 | 2 |
| 91 | 10 |
| 92 | 0 |
| 93 | 2 |
| 94 | 87 |
| 95 | 98 |
| 96 | 3 |
| 97 | 85 |
| 98 | 41 |
| 99 | 9 |
| 100 | 57 |
| 101 | 72 |
| 102 | 3 |
| 103 | 23 |

### files

| id | dir | language | category | bytes | lines | binary | secret | generated | vendored |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 17 | javascript | code | 128 | 4 | false | false | false | true |
| 1 | 86 | typescript | code | 128 | 1 | false | false | false | false |
| 2 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 3 | 14 | tsx | code | 16384 | 512 | false | false | false | false |
| 4 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 5 | 21 | typescript | code | 8192 | 256 | false | false | false | false |
| 6 | 70 | json | data | 16384 | 256 | false | false | false | false |
| 7 | 12 | typescript | code | 2048 | 32 | false | false | false | false |
| 8 | 99 | json | data | 8192 | 256 | false | false | false | false |
| 9 | 45 | json | lockfile | 512 | 16 | false | false | true | false |
| 10 | 96 | typescript | code | 4096 | 128 | false | false | false | false |
| 11 | 21 | typescript | code | 32768 | 512 | false | false | false | false |
| 12 | 77 | tsx | code | 16384 | 512 | false | false | false | false |
| 13 | 94 | markdown | docs | 16384 | 256 | false | false | false | true |
| 14 | 70 | json | data | 524288 | 16384 | false | false | false | false |
| 15 | 99 | text | docs | 1024 | 32 | false | false | false | false |
| 16 | 24 | typescript | code | 16384 | 512 | false | false | false | false |
| 17 | 70 | text | docs | 512 | 64 | false | false | false | false |
| 18 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 19 | 99 | json | data | 16384 | 512 | false | false | false | false |
| 20 | 26 | typescript | code | 4096 | 128 | false | false | false | false |
| 21 | 99 | json | data | 512 | 32 | false | false | false | false |
| 22 | 86 | javascript | code | 128 | 2 | false | false | false | false |
| 23 | 68 | tsx | code | 32768 | 512 | false | false | false | false |
| 24 | 99 | json | data | 512 | 32 | false | false | false | false |
| 25 | 12 | tsx | code | 8192 | 256 | false | false | false | false |
| 26 | 86 | typescript | code | 256 | 8 | false | false | false | false |
| 27 | 77 | typescript | test | 16384 | 512 | false | false | false | false |
| 28 | 77 | typescript | code | 4096 | 128 | false | false | false | false |
| 29 | 63 | typescript | code | 8192 | 256 | false | false | false | false |
| 30 | 2 | json | config | 512 | 32 | false | false | false | false |
| 31 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 32 | 62 | typescript | test | 256 | 16 | false | false | false | false |
| 33 | 32 | typescript | code | 8192 | 128 | false | false | false | false |
| 34 | 5 | tsx | code | 65536 | 1024 | false | false | false | false |
| 35 | 88 | tsx | code | 1024 | 32 | false | false | false | false |
| 36 | 99 | json | data | 512 | 32 | false | false | false | false |
| 37 | 70 | text | docs | 16384 | 256 | false | false | false | false |
| 38 | 38 | json | config | 65536 | 2048 | false | false | false | false |
| 39 | 5 | tsx | code | 32768 | 1024 | false | false | false | false |
| 40 | 28 | json-with-comments | config | 128 | 1 | false | false | false | false |
| 41 | 62 | typescript | test | 1024 | 64 | false | false | false | false |
| 42 | 90 | markdown | docs | 4096 | 64 | false | false | false | false |
| 43 | 62 | typescript | test | 512 | 16 | false | false | false | false |
| 44 | 88 | tsx | code | 1024 | 32 | false | false | false | false |
| 45 | 72 | typescript | code | 32768 | 1024 | false | false | false | false |
| 46 | 101 | typescript | code | 32768 | 512 | false | false | false | false |
| 47 | 73 | tsx | code | 16384 | 512 | false | false | false | false |
| 48 | 12 | typescript | code | 4096 | 64 | false | false | false | false |
| 49 | 86 | typescript | code | 256 | 4 | false | false | false | false |
| 50 | 99 | text | docs | 1024 | 32 | false | false | false | false |
| 51 | 5 | tsx | code | 16384 | 256 | false | false | false | false |
| 52 | 24 | typescript | code | 8192 | 128 | false | false | false | false |
| 53 | 12 | tsx | code | 8192 | 256 | false | false | false | false |
| 54 | 70 | json | data | 65536 | 4096 | false | false | false | false |
| 55 | 72 | typescript | code | 32768 | 512 | false | false | false | false |
| 56 | 12 | typescript | code | 2048 | 32 | false | false | false | false |
| 57 | 18 | typescript | test | 16384 | 512 | false | false | false | false |
| 58 | 45 | typescript | code | 16384 | 512 | false | false | false | false |
| 59 | 34 | json | data | 4096 | 256 | false | false | false | false |
| 60 | 23 | markdown | docs | 4096 | 32 | false | false | false | true |
| 61 | 32 | python | code | 4096 | 64 | false | false | false | false |
| 62 | 18 | typescript | test | 8192 | 128 | false | false | false | false |
| 63 | 12 | tsx | code | 8192 | 256 | false | false | false | false |
| 64 | 86 | json | config | 16 | 1 | false | false | false | false |
| 65 | 86 | typescript | code | 64 | 4 | false | false | false | false |
| 66 | 10 | markdown | docs | 16384 | 256 | false | false | false | false |
| 67 | 86 | json-with-comments | config | 512 | 1 | false | false | false | false |
| 68 | 73 | typescript | code | 16384 | 256 | false | false | false | false |
| 69 | 99 | json | data | 4096 | 256 | false | false | false | false |
| 70 | 89 | typescript | code | 2048 | 64 | false | false | false | false |
| 71 | 20 | text | unknown | 256 | 2 | false | false | false | false |
| 72 | 77 | tsx | code | 4096 | 128 | false | false | false | false |
| 73 | 73 | tsx | code | 512 | 8 | false | false | false | false |
| 74 | 59 | typescript | code | 16384 | 512 | false | false | false | false |
| 75 | 88 | tsx | code | 1024 | 32 | false | false | false | false |
| 76 | 64 | json | data | 65536 | 4096 | false | false | false | false |
| 77 | 73 | tsx | code | 8192 | 128 | false | false | false | false |
| 78 | 78 | json-with-comments | config | 256 | 1 | false | false | false | false |
| 79 | 48 | typescript | code | 8192 | 256 | false | false | false | false |
| 80 | 54 | tsx | code | 4096 | 128 | false | false | false | false |
| 81 | 12 | tsx | code | 4096 | 128 | false | false | false | false |
| 82 | 7 | markdown | docs | 131072 | 8192 | false | false | false | false |
| 83 | 51 | typescript | code | 1024 | 32 | false | false | false | false |
| 84 | 88 | tsx | code | 4096 | 128 | false | false | false | false |
| 85 | 70 | json | data | 8192 | 512 | false | false | false | false |
| 86 | 86 | javascript | code | 128 | 2 | false | false | false | false |
| 87 | 71 | text | unknown | 128 | 1 | false | false | false | false |
| 88 | 32 | typescript | code | 1024 | 32 | false | false | false | false |
| 89 | 48 | typescript | code | 65536 | 1024 | false | false | false | false |
| 90 | 39 | json | data | 131072 | 8192 | false | false | false | false |
| 91 | 91 | typescript | code | 8192 | 128 | false | false | false | false |
| 92 | 86 | vue | code | 128 | 1 | false | false | false | false |
| 93 | 93 | typescript | code | 16384 | 256 | false | false | false | false |
| 94 | 62 | typescript | test | 128 | 4 | false | false | false | false |
| 95 | 5 | tsx | code | 32768 | 512 | false | false | false | false |
| 96 | 69 | svg | image | 8192 | 8 | false | false | true | false |
| 97 | 95 | markdown | docs | 65536 | 4096 | false | false | false | false |
| 98 | 32 | typescript | code | 4096 | 64 | false | false | false | false |
| 99 | 4 | typescript | code | 65536 | 2048 | false | false | false | false |
| 100 | 18 | typescript | test | 16384 | 256 | false | false | false | false |
| 101 | 75 | typescript | code | 64 | 1 | false | false | false | false |
| 102 | 73 | tsx | code | 32768 | 1024 | false | false | false | false |
| 103 | 31 | typescript | code | 2048 | 64 | false | false | false | false |
| 104 | 70 | binary | archive | 16384 | 0 | true | false | false | false |
| 105 | 13 | tsx | code | 16384 | 256 | false | false | false | false |
| 106 | 45 | typescript | code | 2048 | 32 | false | false | false | false |
| 107 | 58 | markdown | docs | 16384 | 512 | false | false | false | false |
| 108 | 11 | typescript | code | 32768 | 4096 | false | false | false | false |
| 109 | 99 | text | docs | 1024 | 32 | false | false | false | false |
| 110 | 32 | python | code | 2048 | 64 | false | false | false | false |
| 111 | 86 | typescript | code | 128 | 1 | false | false | false | false |
| 112 | 98 | text | unknown | 32768 | 32 | false | false | false | false |
| 113 | 86 | typescript | code | 128 | 4 | false | false | false | false |
| 114 | 45 | json | config | 256 | 8 | false | false | false | false |
| 115 | 99 | json | data | 1024 | 64 | false | false | false | false |
| 116 | 70 | text | unknown | 2048 | 64 | false | false | false | false |
| 117 | 70 | text | docs | 65536 | 1024 | false | false | false | false |
| 118 | 99 | json | data | 512 | 32 | false | false | false | false |
| 119 | 26 | typescript | code | 4096 | 128 | false | false | false | false |
| 120 | 18 | typescript | test | 65536 | 1024 | false | false | false | false |
| 121 | 72 | typescript | code | 16384 | 512 | false | false | false | false |
| 122 | 70 | json | data | 8192 | 256 | false | false | false | false |
| 123 | 100 | html | markup | 32768 | 256 | false | false | false | false |
| 124 | 86 | typescript | code | 128 | 2 | false | false | false | false |
| 125 | 46 | markdown | docs | 131072 | 1024 | false | false | false | false |
| 126 | 45 | typescript | code | 4096 | 128 | false | false | false | false |
| 127 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 128 | 18 | typescript | test | 2048 | 64 | false | false | false | false |
| 129 | 70 | json | data | 16384 | 512 | false | false | false | false |
| 130 | 88 | tsx | code | 8192 | 256 | false | false | false | false |
| 131 | 5 | typescript | code | 16384 | 512 | false | false | false | false |
| 132 | 101 | typescript | code | 16384 | 512 | false | false | false | false |
| 133 | 24 | typescript | code | 8192 | 256 | false | false | false | false |
| 134 | 18 | typescript | test | 65536 | 2048 | false | false | false | false |
| 135 | 49 | json | data | 32768 | 1024 | false | false | false | false |
| 136 | 42 | typescript | code | 65536 | 1024 | false | false | false | false |
| 137 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 138 | 72 | typescript | code | 16384 | 512 | false | false | false | false |
| 139 | 15 | json | data | 32768 | 1024 | false | false | false | false |
| 140 | 18 | typescript | test | 8192 | 256 | false | false | false | false |
| 141 | 12 | typescript | code | 8192 | 256 | false | false | false | false |
| 142 | 30 | json | config | 128 | 1 | false | false | false | false |
| 143 | 68 | tsx | code | 16384 | 512 | false | false | false | false |
| 144 | 59 | typescript | code | 8192 | 256 | false | false | false | false |
| 145 | 32 | typescript | code | 1024 | 16 | false | false | false | false |
| 146 | 45 | python | code | 8192 | 128 | false | false | false | false |
| 147 | 86 | typescript | code | 128 | 1 | false | false | false | false |
| 148 | 70 | json | data | 8192 | 256 | false | false | false | false |
| 149 | 99 | json | data | 32768 | 1024 | false | false | false | false |
| 150 | 73 | tsx | code | 4096 | 128 | false | false | false | false |
| 151 | 2 | json | data | 1024 | 64 | false | false | false | false |
| 152 | 88 | tsx | code | 4096 | 128 | false | false | false | false |
| 153 | 68 | tsx | code | 16384 | 256 | false | false | false | false |
| 154 | 12 | tsx | code | 4096 | 128 | false | false | false | false |
| 155 | 86 | typescript | code | 128 | 4 | false | false | false | false |
| 156 | 70 | text | docs | 2048 | 64 | false | false | false | false |
| 157 | 6 | typescript | code | 64 | 1 | false | false | false | false |
| 158 | 73 | tsx | code | 16384 | 512 | false | false | false | false |
| 159 | 91 | json | data | 8192 | 128 | false | false | false | false |
| 160 | 2 | text | docs | 1024 | 16 | false | false | false | false |
| 161 | 61 | yaml | config | 128 | 4 | false | false | false | true |
| 162 | 99 | json | data | 512 | 32 | false | false | false | false |
| 163 | 86 | vue | code | 128 | 1 | false | false | false | false |
| 164 | 99 | json | data | 16384 | 1024 | false | false | false | false |
| 165 | 72 | typescript | code | 16384 | 256 | false | false | false | false |
| 166 | 99 | json | data | 4096 | 512 | false | false | false | false |
| 167 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 168 | 72 | typescript | code | 16384 | 512 | false | false | false | false |
| 169 | 18 | typescript | test | 16384 | 256 | false | false | false | false |
| 170 | 99 | json | data | 2048 | 64 | false | false | false | false |
| 171 | 92 | json-with-comments | test | 512 | 32 | false | false | false | false |
| 172 | 65 | markdown | docs | 32768 | 512 | false | false | false | false |
| 173 | 14 | tsx | code | 8192 | 256 | false | false | false | false |
| 174 | 49 | json | data | 8192 | 128 | false | false | false | false |
| 175 | 62 | typescript | test | 1024 | 32 | false | false | false | false |
| 176 | 2 | markdown | docs | 16384 | 256 | false | false | false | false |
| 177 | 18 | typescript | test | 32768 | 512 | false | false | false | false |
| 178 | 12 | tsx | code | 8192 | 256 | false | false | false | false |
| 179 | 12 | tsx | code | 8192 | 256 | false | false | false | false |
| 180 | 14 | tsx | code | 8192 | 256 | false | false | false | false |
| 181 | 86 | typescript | code | 256 | 4 | false | false | false | false |
| 182 | 73 | tsx | code | 32768 | 512 | false | false | false | false |
| 183 | 100 | html | markup | 16384 | 256 | false | false | false | false |
| 184 | 73 | typescript | code | 8192 | 256 | false | false | false | false |
| 185 | 31 | tsx | code | 4096 | 128 | false | false | false | false |
| 186 | 21 | typescript | code | 16384 | 512 | false | false | false | false |
| 187 | 93 | typescript | code | 4096 | 128 | false | false | false | false |
| 188 | 99 | json | data | 2048 | 64 | false | false | false | false |
| 189 | 70 | text | docs | 65536 | 128 | false | false | false | false |
| 190 | 70 | json | data | 2048 | 64 | false | false | false | false |
| 191 | 7 | json | data | 131072 | 8192 | false | false | false | false |
| 192 | 70 | text | unknown | 1024 | 64 | false | false | false | false |
| 193 | 24 | typescript | code | 8192 | 256 | false | false | false | false |
| 194 | 47 | yaml | config | 128 | 4 | false | false | false | true |
| 195 | 72 | typescript | code | 65536 | 2048 | false | false | false | false |
| 196 | 91 | typescript | code | 2048 | 32 | false | false | false | false |
| 197 | 72 | typescript | code | 32768 | 512 | false | false | false | false |
| 198 | 72 | typescript | code | 32768 | 512 | false | false | false | false |
| 199 | 32 | json | data | 2048 | 128 | false | false | false | false |
| 200 | 14 | tsx | code | 8192 | 256 | false | false | false | false |
| 201 | 21 | typescript | code | 16384 | 512 | false | false | false | false |
| 202 | 99 | json | data | 32768 | 1024 | false | false | false | false |
| 203 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 204 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 205 | 70 | binary | archive | 524288 | 0 | true | false | false | false |
| 206 | 35 | json-with-comments | config | 64 | 1 | false | false | false | false |
| 207 | 5 | typescript | code | 16384 | 256 | false | false | false | false |
| 208 | 99 | json | data | 2048 | 64 | false | false | false | false |
| 209 | 18 | typescript | test | 8192 | 256 | false | false | false | false |
| 210 | 43 | json | data | 8192 | 256 | false | false | false | false |
| 211 | 18 | typescript | test | 16384 | 256 | false | false | false | false |
| 212 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 213 | 70 | binary | archive | 65536 | 0 | true | false | false | false |
| 214 | 40 | typescript | code | 16384 | 256 | false | false | false | false |
| 215 | 4 | typescript | code | 16384 | 512 | false | false | false | false |
| 216 | 88 | tsx | code | 4096 | 128 | false | false | false | false |
| 217 | 86 | typescript | code | 128 | 2 | false | false | false | false |
| 218 | 99 | json | data | 131072 | 8192 | false | false | false | false |
| 219 | 21 | typescript | code | 8192 | 128 | false | false | false | false |
| 220 | 87 | markdown | docs | 4096 | 64 | false | false | false | true |
| 221 | 1 | typescript | code | 64 | 1 | false | false | false | false |
| 222 | 99 | json | data | 8192 | 512 | false | false | false | false |
| 223 | 21 | typescript | code | 8192 | 128 | false | false | false | false |
| 224 | 70 | json | data | 8192 | 512 | false | false | false | false |
| 225 | 12 | typescript | code | 2048 | 64 | false | false | false | false |
| 226 | 72 | typescript | code | 32768 | 1024 | false | false | false | false |
| 227 | 18 | typescript | test | 16384 | 256 | false | false | false | false |
| 228 | 5 | typescript | test | 32768 | 512 | false | false | false | false |
| 229 | 70 | json | data | 32768 | 512 | false | false | false | false |
| 230 | 80 | markdown | docs | 16384 | 256 | false | false | false | true |
| 231 | 5 | typescript | code | 16384 | 256 | false | false | false | false |
| 232 | 26 | typescript | code | 4096 | 128 | false | false | false | false |
| 233 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 234 | 16 | markdown | docs | 32768 | 2048 | false | false | false | false |
| 235 | 73 | typescript | code | 4096 | 64 | false | false | false | false |
| 236 | 86 | svelte | code | 128 | 1 | false | false | false | false |
| 237 | 3 | html | markup | 4096 | 32 | false | false | false | false |
| 238 | 52 | typescript | code | 8192 | 256 | false | false | false | false |
| 239 | 73 | typescript | code | 8192 | 128 | false | false | false | false |
| 240 | 70 | json | data | 2048 | 128 | false | false | false | false |
| 241 | 62 | typescript | test | 1024 | 32 | false | false | false | false |
| 242 | 99 | json | data | 524288 | 32768 | false | false | false | false |
| 243 | 18 | typescript | test | 8192 | 128 | false | false | false | false |
| 244 | 68 | tsx | code | 32768 | 1024 | false | false | false | false |
| 245 | 18 | typescript | test | 32768 | 512 | false | false | false | false |
| 246 | 68 | tsx | code | 32768 | 512 | false | false | false | false |
| 247 | 86 | typescript | code | 32 | 1 | false | false | false | false |
| 248 | 91 | typescript | code | 8192 | 256 | false | false | false | false |
| 249 | 18 | typescript | test | 4096 | 64 | false | false | false | false |
| 250 | 20 | text | unknown | 2048 | 32 | false | false | false | false |
| 251 | 81 | typescript | code | 64 | 1 | false | false | false | false |
| 252 | 86 | typescript | code | 256 | 4 | false | false | false | false |
| 253 | 66 | typescript | code | 1024 | 16 | false | false | false | false |
| 254 | 3 | css | style | 16384 | 512 | false | false | false | false |
| 255 | 72 | typescript | code | 8192 | 128 | false | false | false | false |
| 256 | 70 | json | data | 16384 | 256 | false | false | false | false |
| 257 | 19 | markdown | docs | 32768 | 2048 | false | false | false | false |
| 258 | 18 | typescript | test | 65536 | 1024 | false | false | false | false |
| 259 | 5 | typescript | code | 8192 | 128 | false | false | false | false |
| 260 | 50 | yaml | config | 256 | 8 | false | false | false | true |
| 261 | 76 | typescript | code | 32 | 1 | false | false | false | false |
| 262 | 2 | ignore-list | config | 1024 | 64 | false | false | false | false |
| 263 | 48 | typescript | code | 8192 | 128 | false | false | false | false |
| 264 | 99 | text | docs | 1024 | 32 | false | false | false | false |
| 265 | 70 | json | data | 8192 | 512 | false | false | false | false |
| 266 | 52 | typescript | code | 16384 | 256 | false | false | false | false |
| 267 | 86 | astro | code | 64 | 4 | false | false | false | false |
| 268 | 59 | typescript | code | 131072 | 2048 | false | false | false | false |
| 269 | 70 | json | data | 16384 | 512 | false | false | false | false |
| 270 | 99 | json | data | 4096 | 256 | false | false | false | false |
| 271 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 272 | 88 | tsx | code | 4096 | 128 | false | false | false | false |
| 273 | 2 | text | docs | 16384 | 256 | false | false | false | false |
| 274 | 69 | svg | image | 1024 | 1 | false | false | false | false |
| 275 | 99 | json | data | 65536 | 4096 | false | false | false | false |
| 276 | 63 | typescript | code | 4096 | 128 | false | false | false | false |
| 277 | 18 | typescript | test | 4096 | 64 | false | false | false | false |
| 278 | 49 | markdown | docs | 16384 | 128 | false | false | false | false |
| 279 | 70 | json | data | 2048 | 128 | false | false | false | false |
| 280 | 26 | tsx | code | 2048 | 64 | false | false | false | false |
| 281 | 62 | tsx | test | 2048 | 128 | false | false | false | false |
| 282 | 88 | tsx | code | 8192 | 256 | false | false | false | false |
| 283 | 13 | tsx | code | 8192 | 128 | false | false | false | false |
| 284 | 35 | typescript | code | 64 | 1 | false | false | false | false |
| 285 | 72 | typescript | code | 8192 | 256 | false | false | false | false |
| 286 | 100 | html | markup | 16384 | 128 | false | false | false | false |
| 287 | 99 | json | data | 512 | 32 | false | false | false | false |
| 288 | 18 | typescript | test | 32768 | 512 | false | false | false | false |
| 289 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 290 | 18 | typescript | test | 8192 | 128 | false | false | false | false |
| 291 | 14 | tsx | code | 65536 | 1024 | false | false | false | false |
| 292 | 21 | typescript | code | 32768 | 1024 | false | false | false | false |
| 293 | 72 | typescript | code | 16384 | 512 | false | false | false | false |
| 294 | 100 | html | markup | 16384 | 256 | false | false | false | false |
| 295 | 27 | markdown | docs | 16384 | 256 | false | false | false | true |
| 296 | 87 | markdown | docs | 8192 | 256 | false | false | false | true |
| 297 | 4 | typescript | code | 131072 | 2048 | false | false | true | false |
| 298 | 100 | html | markup | 16384 | 256 | false | false | false | false |
| 299 | 45 | typescript | code | 4096 | 64 | false | false | false | false |
| 300 | 4 | typescript | code | 65536 | 2048 | false | false | false | false |
| 301 | 68 | tsx | code | 32768 | 1024 | false | false | false | false |
| 302 | 88 | tsx | code | 2048 | 32 | false | false | false | false |
| 303 | 91 | json | data | 16384 | 256 | false | false | false | false |
| 304 | 70 | json | data | 8192 | 256 | false | false | false | false |
| 305 | 70 | binary | archive | 4096 | 0 | true | false | false | false |
| 306 | 2 | markdown | docs | 16384 | 256 | false | false | false | false |
| 307 | 18 | typescript | test | 16384 | 256 | false | false | false | false |
| 308 | 21 | typescript | code | 32768 | 512 | false | false | false | false |
| 309 | 73 | typescript | code | 4096 | 128 | false | false | false | false |
| 310 | 73 | tsx | code | 16384 | 256 | false | false | false | false |
| 311 | 70 | json | data | 8192 | 256 | false | false | false | false |
| 312 | 2 | typescript | code | 8192 | 128 | false | false | false | false |
| 313 | 5 | tsx | code | 16384 | 256 | false | false | false | false |
| 314 | 18 | typescript | test | 8192 | 128 | false | false | false | false |
| 315 | 3 | css | style | 4096 | 64 | false | false | false | false |
| 316 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 317 | 77 | typescript | code | 1024 | 32 | false | false | false | false |
| 318 | 70 | json | data | 1048576 | 32768 | false | false | false | false |
| 319 | 70 | binary | archive | 131072 | 0 | true | false | false | false |
| 320 | 88 | tsx | code | 8192 | 256 | false | false | false | false |
| 321 | 67 | markdown | docs | 4096 | 128 | false | false | false | false |
| 322 | 32 | python | code | 8192 | 128 | false | false | false | false |
| 323 | 72 | typescript | code | 65536 | 2048 | false | false | false | false |
| 324 | 5 | typescript | test | 4096 | 128 | false | false | false | false |
| 325 | 99 | text | unknown | 1024 | 16 | false | false | false | false |
| 326 | 58 | markdown | docs | 16384 | 256 | false | false | false | false |
| 327 | 62 | javascript | test | 512 | 32 | false | false | false | false |
| 328 | 4 | typescript | code | 4096 | 128 | false | false | false | false |
| 329 | 93 | typescript | code | 16384 | 256 | false | false | false | false |
| 330 | 15 | markdown | docs | 16384 | 128 | false | false | false | false |
| 331 | 79 | markdown | docs | 8192 | 64 | false | false | false | false |
| 332 | 70 | json | data | 8192 | 256 | false | false | false | false |
| 333 | 72 | typescript | code | 32768 | 1024 | false | false | false | false |
| 334 | 73 | typescript | code | 4096 | 128 | false | false | false | false |
| 335 | 13 | tsx | code | 8192 | 256 | false | false | false | false |
| 336 | 103 | markdown | docs | 32768 | 512 | false | false | false | true |
| 337 | 5 | typescript | code | 32768 | 512 | false | false | false | false |
| 338 | 24 | typescript | code | 32768 | 1024 | false | false | false | false |
| 339 | 40 | typescript | code | 8192 | 128 | false | false | false | false |
| 340 | 69 | svg | image | 8192 | 8 | false | false | true | false |
| 341 | 46 | markdown | docs | 8192 | 128 | false | false | false | false |
| 342 | 42 | typescript | code | 131072 | 2048 | false | false | false | false |
| 343 | 5 | typescript | test | 16384 | 512 | false | false | false | false |
| 344 | 48 | typescript | code | 8192 | 128 | false | false | false | false |
| 345 | 5 | typescript | code | 32768 | 512 | false | false | false | false |
| 346 | 86 | vue | code | 128 | 1 | false | false | false | false |
| 347 | 45 | json | data | 8192 | 1 | false | false | false | false |
| 348 | 70 | json | data | 16384 | 256 | false | false | false | false |
| 349 | 2 | json-with-comments | config | 2048 | 64 | false | false | false | false |
| 350 | 63 | typescript | code | 32768 | 512 | false | false | false | false |
| 351 | 96 | typescript | code | 512 | 8 | false | false | false | false |
| 352 | 48 | typescript | code | 65536 | 1024 | false | false | false | false |
| 353 | 86 | typescript | code | 256 | 4 | false | false | false | false |
| 354 | 93 | typescript | code | 32768 | 512 | false | false | false | false |
| 355 | 62 | typescript | test | 256 | 8 | false | false | false | false |
| 356 | 32 | typescript | code | 2048 | 32 | false | false | false | false |
| 357 | 86 | javascript | code | 64 | 1 | false | false | false | false |
| 358 | 86 | vue | code | 128 | 1 | false | false | false | false |
| 359 | 5 | tsx | code | 32768 | 1024 | false | false | false | false |
| 360 | 83 | json | config | 64 | 1 | false | false | false | false |
| 361 | 88 | tsx | code | 8192 | 256 | false | false | false | false |
| 362 | 77 | typescript | code | 512 | 16 | false | false | false | false |
| 363 | 64 | markdown | docs | 65536 | 4096 | false | false | false | false |
| 364 | 21 | typescript | code | 32768 | 512 | false | false | false | false |
| 365 | 2 | json | config | 4096 | 128 | false | false | false | false |
| 366 | 1 | json-with-comments | config | 64 | 1 | false | false | false | false |
| 367 | 26 | typescript | code | 512 | 16 | false | false | false | false |
| 368 | 91 | json | data | 4096 | 256 | false | false | false | false |
| 369 | 18 | typescript | test | 4096 | 64 | false | false | false | false |
| 370 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 371 | 5 | typescript | code | 4096 | 128 | false | false | false | false |
| 372 | 45 | typescript | code | 4096 | 64 | false | false | false | false |
| 373 | 19 | json | data | 65536 | 2048 | false | false | false | false |
| 374 | 86 | tsx | code | 512 | 8 | false | false | false | false |
| 375 | 73 | typescript | code | 2048 | 64 | false | false | false | false |
| 376 | 86 | typescript | code | 256 | 2 | false | false | false | false |
| 377 | 72 | typescript | code | 65536 | 2048 | false | false | false | false |
| 378 | 72 | typescript | code | 4096 | 128 | false | false | false | false |
| 379 | 70 | json | data | 8192 | 512 | false | false | false | false |
| 380 | 79 | json | data | 8192 | 64 | false | false | false | false |
| 381 | 99 | json | data | 65536 | 2048 | false | false | false | false |
| 382 | 45 | typescript | code | 8192 | 128 | false | false | false | false |
| 383 | 86 | typescript | code | 256 | 4 | false | false | false | false |
| 384 | 24 | typescript | code | 8192 | 128 | false | false | false | false |
| 385 | 46 | markdown | docs | 65536 | 512 | false | false | false | false |
| 386 | 62 | typescript | test | 1024 | 64 | false | false | false | false |
| 387 | 52 | typescript | code | 4096 | 128 | false | false | false | false |
| 388 | 21 | typescript | code | 8192 | 256 | false | false | false | false |
| 389 | 55 | yaml | build | 4096 | 64 | false | false | false | false |
| 390 | 2 | text | unknown | 131072 | 2048 | false | false | false | false |
| 391 | 33 | typescript | code | 128 | 1 | false | false | false | false |
| 392 | 24 | typescript | code | 4096 | 128 | false | false | false | false |
| 393 | 59 | typescript | code | 32768 | 1024 | false | false | false | false |
| 394 | 5 | tsx | code | 16384 | 512 | false | false | false | false |
| 395 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 396 | 45 | typescript | code | 4096 | 64 | false | false | false | false |
| 397 | 99 | json | data | 32768 | 1024 | false | false | false | false |
| 398 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 399 | 12 | typescript | code | 8192 | 128 | false | false | false | false |
| 400 | 71 | text | unknown | 2048 | 32 | false | false | false | false |
| 401 | 2 | markdown | docs | 4096 | 64 | false | false | false | false |
| 402 | 39 | markdown | docs | 131072 | 8192 | false | false | false | false |
| 403 | 70 | json | data | 2048 | 64 | false | false | false | false |
| 404 | 98 | json | data | 256 | 16 | false | false | false | false |
| 405 | 10 | typescript | code | 2048 | 64 | false | false | false | false |
| 406 | 52 | typescript | code | 8192 | 256 | false | false | false | false |
| 407 | 24 | typescript | code | 4096 | 128 | false | false | false | false |
| 408 | 2 | markdown | docs | 32768 | 512 | false | false | false | false |
| 409 | 34 | python | code | 256 | 1 | false | false | false | false |
| 410 | 5 | typescript | test | 16384 | 256 | false | false | false | false |
| 411 | 68 | tsx | code | 32768 | 512 | false | false | false | false |
| 412 | 31 | html | markup | 1024 | 32 | false | false | false | false |
| 413 | 83 | typescript | code | 128 | 1 | false | false | false | false |
| 414 | 18 | typescript | test | 8192 | 128 | false | false | false | false |
| 415 | 12 | tsx | code | 1024 | 16 | false | false | false | false |
| 416 | 73 | typescript | code | 4096 | 128 | false | false | false | false |
| 417 | 82 | typescript | code | 4096 | 128 | false | false | false | false |
| 418 | 26 | tsx | code | 32768 | 512 | false | false | false | false |
| 419 | 73 | tsx | code | 16384 | 256 | false | false | false | false |
| 420 | 45 | typescript | code | 2048 | 64 | false | false | false | false |
| 421 | 3 | tsx | code | 16384 | 512 | false | false | false | false |
| 422 | 18 | typescript | test | 65536 | 1024 | false | false | false | false |
| 423 | 73 | tsx | code | 2048 | 64 | false | false | false | false |
| 424 | 48 | typescript | code | 2048 | 64 | false | false | false | false |
| 425 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 426 | 5 | typescript | code | 32768 | 1024 | false | false | false | false |
| 427 | 91 | typescript | code | 4096 | 128 | false | false | false | false |
| 428 | 77 | tsx | code | 4096 | 64 | false | false | false | false |
| 429 | 12 | tsx | code | 8192 | 256 | false | false | false | false |
| 430 | 101 | typescript | code | 16384 | 512 | false | false | false | false |
| 431 | 15 | json | data | 8192 | 128 | false | false | false | false |
| 432 | 25 | typescript | code | 64 | 1 | false | false | false | false |
| 433 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 434 | 91 | typescript | code | 8192 | 256 | false | false | false | false |
| 435 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 436 | 95 | json | data | 65536 | 4096 | false | false | false | false |
| 437 | 54 | typescript | code | 8192 | 32 | false | false | true | false |
| 438 | 2 | json | lockfile | 131072 | 1024 | false | false | true | false |
| 439 | 73 | tsx | code | 8192 | 256 | false | false | false | false |
| 440 | 18 | typescript | test | 32768 | 512 | false | false | false | false |
| 441 | 96 | typescript | code | 4096 | 128 | false | false | false | false |
| 442 | 86 | typescript | code | 256 | 2 | false | false | false | false |
| 443 | 46 | markdown | docs | 131072 | 512 | false | false | false | false |
| 444 | 10 | ignore-list | config | 256 | 16 | false | false | false | false |
| 445 | 32 | typescript | code | 4096 | 64 | false | false | false | false |
| 446 | 18 | typescript | test | 65536 | 1024 | false | false | false | false |
| 447 | 70 | json | data | 131072 | 8192 | false | false | false | false |
| 448 | 99 | json | data | 524288 | 16384 | false | false | false | false |
| 449 | 3 | tsx | code | 1024 | 32 | false | false | false | false |
| 450 | 86 | typescript | code | 128 | 2 | false | false | false | false |
| 451 | 97 | typescript | code | 64 | 1 | false | false | false | false |
| 452 | 26 | tsx | code | 16384 | 512 | false | false | false | false |
| 453 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 454 | 16 | json | data | 65536 | 2048 | false | false | false | false |
| 455 | 99 | json | data | 262144 | 8192 | false | false | false | false |
| 456 | 62 | typescript | test | 2048 | 128 | false | false | false | false |
| 457 | 99 | json | data | 512 | 32 | false | false | false | false |
| 458 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 459 | 52 | typescript | code | 2048 | 32 | false | false | false | false |
| 460 | 85 | json | config | 128 | 1 | false | false | false | false |
| 461 | 86 | typescript | code | 32 | 1 | false | false | false | false |
| 462 | 99 | text | docs | 1024 | 32 | false | false | false | false |
| 463 | 99 | json | data | 131072 | 8192 | false | false | false | false |
| 464 | 88 | tsx | code | 2048 | 64 | false | false | false | false |
| 465 | 2 | typescript | code | 512 | 32 | false | false | true | false |
| 466 | 100 | json | config | 16384 | 256 | false | false | false | false |
| 467 | 18 | typescript | test | 32768 | 1024 | false | false | false | false |
| 468 | 77 | typescript | code | 32768 | 1024 | false | false | false | false |
| 469 | 99 | json | data | 2048 | 64 | false | false | false | false |
| 470 | 88 | tsx | code | 4096 | 64 | false | false | false | false |
| 471 | 70 | json | data | 512 | 32 | false | false | false | false |
| 472 | 5 | typescript | code | 65536 | 2048 | false | false | false | false |
| 473 | 66 | typescript | code | 8192 | 128 | false | false | false | false |
| 474 | 70 | json | data | 131072 | 2048 | false | false | false | false |
| 475 | 14 | tsx | code | 4096 | 128 | false | false | false | false |
| 476 | 2 | markdown | docs | 4096 | 128 | false | false | false | false |
| 477 | 86 | svelte | code | 128 | 1 | false | false | false | false |
| 478 | 70 | json | data | 8192 | 512 | false | false | false | false |
| 479 | 12 | tsx | code | 2048 | 64 | false | false | false | false |
| 480 | 59 | typescript | code | 8192 | 256 | false | false | false | false |
| 481 | 78 | json-with-comments | config | 128 | 1 | false | false | false | false |
| 482 | 88 | tsx | code | 1024 | 32 | false | false | false | false |
| 483 | 44 | json-with-comments | config | 128 | 1 | false | false | false | false |
| 484 | 18 | typescript | test | 4096 | 128 | false | false | false | false |
| 485 | 2 | toml | config | 256 | 16 | false | false | false | false |
| 486 | 58 | markdown | docs | 32768 | 512 | false | false | false | false |
| 487 | 37 | typescript | code | 8192 | 128 | false | false | false | false |
| 488 | 99 | json | data | 32768 | 1024 | false | false | false | false |
| 489 | 86 | typescript | code | 128 | 1 | false | false | false | false |
| 490 | 88 | tsx | code | 16384 | 256 | false | false | false | false |
| 491 | 13 | tsx | code | 8192 | 128 | false | false | false | false |
| 492 | 70 | binary | archive | 4096 | 0 | true | false | false | false |
| 493 | 48 | typescript | code | 262144 | 4096 | false | false | false | false |
| 494 | 70 | text | unknown | 1024 | 32 | false | false | false | false |
| 495 | 91 | typescript | code | 32768 | 1024 | false | false | false | false |
| 496 | 32 | python | code | 4096 | 64 | false | false | false | false |
| 497 | 99 | json | data | 4096 | 256 | false | false | false | false |
| 498 | 5 | typescript | code | 4096 | 128 | false | false | false | false |
| 499 | 26 | typescript | code | 8192 | 256 | false | false | false | false |
| 500 | 12 | tsx | code | 4096 | 128 | false | false | false | false |
| 501 | 12 | tsx | code | 4096 | 128 | false | false | false | false |
| 502 | 101 | typescript | code | 16384 | 512 | false | false | false | false |
| 503 | 18 | typescript | test | 4096 | 64 | false | false | false | false |
| 504 | 86 | typescript | code | 64 | 1 | false | false | false | false |
| 505 | 99 | json | data | 524288 | 16384 | false | false | false | false |
| 506 | 73 | typescript | code | 4096 | 64 | false | false | false | false |
| 507 | 79 | json | data | 16384 | 512 | false | false | false | false |

### edges

| id | from | to | kind | type |
| --- | --- | --- | --- | --- |
| 0 | 3 | 29 | import | false |
| 1 | 3 | 47 | import | false |
| 2 | 3 | 68 | import | false |
| 3 | 3 | 119 | import | false |
| 4 | 3 | 184 | import | false |
| 5 | 3 | 214 | import | false |
| 6 | 3 | 309 | import | false |
| 7 | 3 | 393 | import | true |
| 8 | 3 | 441 | import | false |
| 9 | 3 | 470 | import | false |
| 10 | 3 | 475 | import | false |
| 11 | 4 | 155 | import | false |
| 12 | 5 | 388 | import | false |
| 13 | 5 | 393 | import | false |
| 14 | 7 | 29 | import | false |
| 15 | 10 | 393 | import | true |
| 16 | 11 | 168 | import | true |
| 17 | 11 | 392 | import | true |
| 18 | 12 | 28 | import | false |
| 19 | 12 | 29 | import | false |
| 20 | 12 | 44 | import | false |
| 21 | 12 | 152 | import | false |
| 22 | 12 | 203 | import | false |
| 23 | 12 | 225 | import | false |
| 24 | 12 | 272 | import | false |
| 25 | 12 | 351 | import | false |
| 26 | 12 | 361 | import | false |
| 27 | 12 | 393 | import | true |
| 28 | 12 | 415 | import | false |
| 29 | 12 | 441 | import | false |
| 30 | 12 | 468 | import | false |
| 31 | 12 | 470 | import | false |
| 32 | 12 | 479 | import | false |
| 33 | 16 | 215 | import | false |
| 34 | 16 | 297 | import | false |
| 35 | 16 | 392 | import | false |
| 36 | 16 | 393 | import | false |
| 37 | 16 | 407 | import | false |
| 38 | 20 | 276 | import | false |
| 39 | 22 | 504 | require | false |
| 40 | 23 | 25 | import | false |
| 41 | 23 | 28 | import | false |
| 42 | 23 | 29 | import | false |
| 43 | 23 | 48 | import | false |
| 44 | 23 | 81 | import | false |
| 45 | 23 | 141 | import | false |
| 46 | 23 | 178 | import | false |
| 47 | 23 | 179 | import | false |
| 48 | 23 | 225 | import | false |
| 49 | 23 | 393 | import | true |
| 50 | 23 | 399 | import | false |
| 51 | 23 | 415 | import | false |
| 52 | 23 | 428 | import | false |
| 53 | 23 | 429 | import | false |
| 54 | 23 | 441 | import | false |
| 55 | 23 | 468 | import | false |
| 56 | 23 | 479 | import | false |
| 57 | 23 | 500 | import | false |
| 58 | 25 | 84 | import | false |
| 59 | 25 | 351 | import | false |
| 60 | 25 | 441 | import | false |
| 61 | 25 | 470 | import | false |
| 62 | 27 | 63 | import | false |
| 63 | 27 | 141 | import | false |
| 64 | 27 | 179 | import | false |
| 65 | 27 | 214 | import | true |
| 66 | 27 | 393 | import | true |
| 67 | 27 | 399 | import | false |
| 68 | 27 | 468 | import | false |
| 69 | 27 | 501 | import | false |
| 70 | 28 | 10 | import | true |
| 71 | 28 | 29 | import | true |
| 72 | 28 | 214 | import | true |
| 73 | 28 | 393 | import | true |
| 74 | 28 | 468 | import | false |
| 75 | 29 | 214 | import | false |
| 76 | 29 | 268 | import | false |
| 77 | 29 | 339 | import | false |
| 78 | 29 | 393 | import | true |
| 79 | 33 | 98 | import | false |
| 80 | 33 | 136 | import | false |
| 81 | 33 | 168 | import | true |
| 82 | 33 | 198 | import | false |
| 83 | 33 | 342 | import | false |
| 84 | 33 | 393 | import | true |
| 85 | 34 | 10 | import | false |
| 86 | 34 | 29 | import | false |
| 87 | 34 | 152 | import | false |
| 88 | 34 | 184 | import | false |
| 89 | 34 | 207 | import | false |
| 90 | 34 | 231 | import | false |
| 91 | 34 | 268 | import | false |
| 92 | 34 | 271 | import | false |
| 93 | 34 | 272 | import | false |
| 94 | 34 | 320 | import | false |
| 95 | 34 | 345 | import | false |
| 96 | 34 | 351 | import | false |
| 97 | 34 | 393 | import | false |
| 98 | 34 | 426 | import | false |
| 99 | 34 | 441 | import | false |
| 100 | 34 | 470 | import | false |
| 101 | 34 | 472 | import | true |
| 102 | 34 | 490 | import | false |
| 103 | 35 | 351 | import | false |
| 104 | 39 | 10 | import | false |
| 105 | 39 | 29 | import | false |
| 106 | 39 | 34 | import | false |
| 107 | 39 | 51 | import | false |
| 108 | 39 | 95 | import | false |
| 109 | 39 | 131 | import | false |
| 110 | 39 | 207 | import | false |
| 111 | 39 | 214 | import | false |
| 112 | 39 | 231 | import | false |
| 113 | 39 | 276 | import | false |
| 114 | 39 | 313 | import | false |
| 115 | 39 | 345 | import | false |
| 116 | 39 | 359 | import | false |
| 117 | 39 | 371 | import | false |
| 118 | 39 | 394 | import | false |
| 119 | 39 | 426 | import | false |
| 120 | 39 | 441 | import | false |
| 121 | 39 | 472 | import | false |
| 122 | 44 | 351 | import | false |
| 123 | 45 | 393 | import | true |
| 124 | 46 | 132 | import | false |
| 125 | 46 | 392 | import | true |
| 126 | 46 | 393 | import | true |
| 127 | 47 | 10 | import | false |
| 128 | 47 | 29 | import | false |
| 129 | 47 | 184 | import | false |
| 130 | 47 | 351 | import | false |
| 131 | 47 | 393 | import | false |
| 132 | 47 | 416 | import | false |
| 133 | 47 | 425 | import | false |
| 134 | 47 | 441 | import | false |
| 135 | 47 | 470 | import | false |
| 136 | 48 | 441 | import | false |
| 137 | 49 | 4 | import | false |
| 138 | 49 | 155 | import | false |
| 139 | 49 | 461 | import | false |
| 140 | 51 | 29 | import | false |
| 141 | 51 | 345 | import | false |
| 142 | 51 | 351 | import | false |
| 143 | 51 | 359 | import | false |
| 144 | 51 | 394 | import | false |
| 145 | 51 | 441 | import | false |
| 146 | 51 | 472 | import | false |
| 147 | 52 | 16 | import | false |
| 148 | 53 | 48 | import | false |
| 149 | 53 | 81 | import | false |
| 150 | 53 | 141 | import | false |
| 151 | 53 | 441 | import | false |
| 152 | 53 | 500 | import | false |
| 153 | 55 | 74 | import | false |
| 154 | 55 | 285 | import | false |
| 155 | 55 | 393 | import | false |
| 156 | 57 | 238 | import | false |
| 157 | 57 | 266 | import | false |
| 158 | 57 | 387 | import | false |
| 159 | 58 | 382 | import | false |
| 160 | 62 | 68 | import | false |
| 161 | 62 | 334 | import | false |
| 162 | 62 | 393 | import | false |
| 163 | 63 | 48 | import | false |
| 164 | 63 | 81 | import | false |
| 165 | 63 | 141 | import | false |
| 166 | 63 | 441 | import | false |
| 167 | 63 | 500 | import | false |
| 168 | 68 | 29 | import | true |
| 169 | 68 | 74 | import | false |
| 170 | 68 | 214 | import | false |
| 171 | 68 | 393 | import | true |
| 172 | 70 | 237 | import | false |
| 173 | 72 | 12 | import | false |
| 174 | 72 | 23 | import | false |
| 175 | 72 | 28 | import | false |
| 176 | 72 | 29 | import | false |
| 177 | 72 | 143 | import | false |
| 178 | 72 | 153 | import | false |
| 179 | 72 | 225 | import | false |
| 180 | 72 | 244 | import | false |
| 181 | 72 | 246 | import | false |
| 182 | 72 | 301 | import | false |
| 183 | 72 | 317 | import | false |
| 184 | 72 | 411 | import | false |
| 185 | 73 | 39 | import | false |
| 186 | 73 | 362 | import | false |
| 187 | 74 | 393 | import | false |
| 188 | 75 | 351 | import | false |
| 189 | 77 | 29 | import | false |
| 190 | 77 | 80 | import | false |
| 191 | 77 | 216 | import | false |
| 192 | 77 | 239 | import | false |
| 193 | 77 | 310 | import | false |
| 194 | 77 | 375 | import | true |
| 195 | 77 | 470 | import | false |
| 196 | 79 | 99 | import | false |
| 197 | 79 | 333 | import | false |
| 198 | 79 | 393 | import | false |
| 199 | 80 | 351 | import | false |
| 200 | 80 | 437 | import | false |
| 201 | 83 | 238 | import | false |
| 202 | 84 | 351 | import | false |
| 203 | 88 | 98 | import | false |
| 204 | 88 | 197 | import | false |
| 205 | 89 | 263 | import | false |
| 206 | 89 | 266 | import | false |
| 207 | 89 | 338 | import | true |
| 208 | 89 | 344 | import | false |
| 209 | 89 | 352 | import | true |
| 210 | 89 | 365 | import | false |
| 211 | 89 | 393 | import | true |
| 212 | 89 | 493 | import | false |
| 213 | 92 | 127 | import | false |
| 214 | 94 | 41 | import | false |
| 215 | 94 | 386 | import | false |
| 216 | 95 | 10 | import | false |
| 217 | 95 | 29 | import | false |
| 218 | 95 | 207 | import | false |
| 219 | 95 | 259 | import | false |
| 220 | 95 | 337 | import | false |
| 221 | 95 | 426 | import | false |
| 222 | 95 | 472 | import | true |
| 223 | 99 | 168 | import | true |
| 224 | 99 | 215 | import | false |
| 225 | 99 | 297 | import | false |
| 226 | 99 | 328 | import | false |
| 227 | 99 | 393 | import | true |
| 228 | 100 | 198 | import | false |
| 229 | 100 | 323 | import | false |
| 230 | 100 | 393 | import | true |
| 231 | 102 | 29 | import | false |
| 232 | 102 | 47 | import | false |
| 233 | 102 | 68 | import | false |
| 234 | 102 | 84 | import | false |
| 235 | 102 | 184 | import | false |
| 236 | 102 | 214 | import | false |
| 237 | 102 | 239 | import | false |
| 238 | 102 | 272 | import | false |
| 239 | 102 | 276 | import | false |
| 240 | 102 | 309 | import | false |
| 241 | 102 | 320 | import | false |
| 242 | 102 | 351 | import | false |
| 243 | 102 | 393 | import | false |
| 244 | 102 | 441 | import | false |
| 245 | 102 | 470 | import | false |
| 246 | 102 | 482 | import | false |
| 247 | 102 | 506 | import | false |
| 248 | 103 | 412 | import | false |
| 249 | 105 | 29 | import | false |
| 250 | 105 | 48 | import | false |
| 251 | 105 | 56 | import | false |
| 252 | 105 | 81 | import | false |
| 253 | 105 | 141 | import | false |
| 254 | 105 | 225 | import | false |
| 255 | 105 | 283 | import | false |
| 256 | 105 | 441 | import | false |
| 257 | 105 | 468 | import | false |
| 258 | 105 | 470 | import | false |
| 259 | 105 | 500 | import | false |
| 260 | 106 | 201 | import | false |
| 261 | 106 | 382 | import | false |
| 262 | 119 | 276 | import | true |
| 263 | 119 | 393 | import | true |
| 264 | 119 | 441 | import | false |
| 265 | 120 | 89 | import | false |
| 266 | 120 | 198 | import | false |
| 267 | 120 | 263 | import | false |
| 268 | 120 | 333 | import | false |
| 269 | 120 | 352 | import | false |
| 270 | 120 | 493 | import | false |
| 271 | 121 | 99 | import | false |
| 272 | 121 | 136 | import | false |
| 273 | 121 | 138 | import | false |
| 274 | 121 | 168 | import | true |
| 275 | 121 | 195 | import | false |
| 276 | 121 | 392 | import | true |
| 277 | 121 | 393 | import | true |
| 278 | 126 | 382 | import | false |
| 279 | 128 | 150 | import | false |
| 280 | 130 | 351 | import | false |
| 281 | 130 | 470 | import | false |
| 282 | 132 | 430 | import | false |
| 283 | 132 | 502 | import | true |
| 284 | 133 | 16 | import | false |
| 285 | 133 | 407 | import | false |
| 286 | 134 | 46 | import | false |
| 287 | 134 | 168 | import | true |
| 288 | 134 | 198 | import | false |
| 289 | 134 | 226 | import | false |
| 290 | 134 | 323 | import | false |
| 291 | 134 | 430 | import | false |
| 292 | 134 | 493 | import | false |
| 293 | 134 | 502 | import | false |
| 294 | 136 | 168 | import | true |
| 295 | 136 | 195 | import | false |
| 296 | 136 | 300 | import | false |
| 297 | 136 | 392 | import | true |
| 298 | 136 | 393 | import | true |
| 299 | 137 | 351 | import | false |
| 300 | 138 | 268 | import | false |
| 301 | 138 | 378 | reference | false |
| 302 | 138 | 393 | import | true |
| 303 | 140 | 29 | import | true |
| 304 | 140 | 68 | import | false |
| 305 | 140 | 184 | import | false |
| 306 | 140 | 339 | import | false |
| 307 | 140 | 350 | import | false |
| 308 | 140 | 393 | import | false |
| 309 | 143 | 25 | import | false |
| 310 | 143 | 28 | import | false |
| 311 | 143 | 29 | import | false |
| 312 | 143 | 48 | import | false |
| 313 | 143 | 141 | import | false |
| 314 | 143 | 225 | import | false |
| 315 | 143 | 393 | import | true |
| 316 | 143 | 415 | import | false |
| 317 | 143 | 428 | import | false |
| 318 | 143 | 429 | import | false |
| 319 | 143 | 441 | import | false |
| 320 | 143 | 479 | import | false |
| 321 | 143 | 500 | import | false |
| 322 | 145 | 98 | import | false |
| 323 | 145 | 198 | import | false |
| 324 | 145 | 323 | import | false |
| 325 | 147 | 251 | import | false |
| 326 | 147 | 451 | import | false |
| 327 | 152 | 351 | import | false |
| 328 | 153 | 28 | import | false |
| 329 | 153 | 29 | import | false |
| 330 | 153 | 48 | import | false |
| 331 | 153 | 178 | import | false |
| 332 | 153 | 179 | import | false |
| 333 | 153 | 225 | import | false |
| 334 | 153 | 276 | import | false |
| 335 | 153 | 393 | import | false |
| 336 | 153 | 428 | import | false |
| 337 | 153 | 429 | import | false |
| 338 | 153 | 441 | import | false |
| 339 | 153 | 468 | import | false |
| 340 | 154 | 47 | import | false |
| 341 | 154 | 351 | import | false |
| 342 | 158 | 29 | import | false |
| 343 | 158 | 80 | import | false |
| 344 | 158 | 184 | import | false |
| 345 | 158 | 214 | import | false |
| 346 | 158 | 216 | import | false |
| 347 | 158 | 239 | import | false |
| 348 | 158 | 309 | import | false |
| 349 | 158 | 310 | import | false |
| 350 | 158 | 351 | import | false |
| 351 | 158 | 393 | import | true |
| 352 | 158 | 398 | import | false |
| 353 | 158 | 441 | import | false |
| 354 | 158 | 470 | import | false |
| 355 | 163 | 1 | import | false |
| 356 | 165 | 45 | import | false |
| 357 | 165 | 393 | import | true |
| 358 | 168 | 392 | import | true |
| 359 | 168 | 393 | import | true |
| 360 | 169 | 16 | import | false |
| 361 | 169 | 255 | import | false |
| 362 | 169 | 266 | import | false |
| 363 | 169 | 338 | import | false |
| 364 | 169 | 392 | import | false |
| 365 | 173 | 47 | import | false |
| 366 | 173 | 68 | import | false |
| 367 | 173 | 214 | import | true |
| 368 | 173 | 309 | import | false |
| 369 | 173 | 393 | import | true |
| 370 | 173 | 441 | import | false |
| 371 | 173 | 475 | import | false |
| 372 | 175 | 456 | import | false |
| 373 | 177 | 168 | import | true |
| 374 | 177 | 195 | import | false |
| 375 | 177 | 300 | import | false |
| 376 | 178 | 29 | import | false |
| 377 | 178 | 351 | import | false |
| 378 | 178 | 415 | import | false |
| 379 | 178 | 500 | import | false |
| 380 | 179 | 48 | import | false |
| 381 | 179 | 81 | import | false |
| 382 | 179 | 141 | import | false |
| 383 | 179 | 441 | import | false |
| 384 | 179 | 500 | import | false |
| 385 | 180 | 10 | import | false |
| 386 | 180 | 29 | import | false |
| 387 | 180 | 47 | import | false |
| 388 | 180 | 68 | import | false |
| 389 | 180 | 214 | import | true |
| 390 | 180 | 309 | import | false |
| 391 | 180 | 393 | import | true |
| 392 | 180 | 416 | import | false |
| 393 | 180 | 441 | import | false |
| 394 | 180 | 470 | import | false |
| 395 | 180 | 475 | import | false |
| 396 | 182 | 29 | import | false |
| 397 | 182 | 47 | import | false |
| 398 | 182 | 130 | import | false |
| 399 | 182 | 144 | import | false |
| 400 | 182 | 184 | import | false |
| 401 | 182 | 239 | import | false |
| 402 | 182 | 268 | import | false |
| 403 | 182 | 276 | import | false |
| 404 | 182 | 309 | import | false |
| 405 | 182 | 310 | import | false |
| 406 | 182 | 350 | import | false |
| 407 | 182 | 361 | import | false |
| 408 | 182 | 441 | import | false |
| 409 | 184 | 29 | import | true |
| 410 | 184 | 268 | import | true |
| 411 | 184 | 393 | import | false |
| 412 | 185 | 29 | import | false |
| 413 | 185 | 39 | import | false |
| 414 | 185 | 80 | import | false |
| 415 | 185 | 254 | import | false |
| 416 | 185 | 271 | import | false |
| 417 | 185 | 276 | import | false |
| 418 | 185 | 417 | import | false |
| 419 | 193 | 16 | import | false |
| 420 | 193 | 393 | import | true |
| 421 | 195 | 45 | import | false |
| 422 | 195 | 168 | import | true |
| 423 | 195 | 300 | import | false |
| 424 | 195 | 393 | import | true |
| 425 | 197 | 168 | import | true |
| 426 | 197 | 393 | import | true |
| 427 | 198 | 393 | import | false |
| 428 | 200 | 3 | import | false |
| 429 | 200 | 29 | import | false |
| 430 | 200 | 35 | import | false |
| 431 | 200 | 47 | import | false |
| 432 | 200 | 173 | import | false |
| 433 | 200 | 180 | import | false |
| 434 | 200 | 291 | import | false |
| 435 | 200 | 309 | import | false |
| 436 | 200 | 310 | import | false |
| 437 | 200 | 441 | import | false |
| 438 | 201 | 5 | import | false |
| 439 | 201 | 11 | import | false |
| 440 | 201 | 168 | import | true |
| 441 | 201 | 186 | import | false |
| 442 | 201 | 219 | import | false |
| 443 | 201 | 292 | import | false |
| 444 | 201 | 308 | import | false |
| 445 | 201 | 364 | import | false |
| 446 | 201 | 388 | import | false |
| 447 | 201 | 392 | import | true |
| 448 | 201 | 393 | import | true |
| 449 | 203 | 351 | import | false |
| 450 | 207 | 214 | import | false |
| 451 | 207 | 337 | import | false |
| 452 | 209 | 138 | import | false |
| 453 | 209 | 268 | import | false |
| 454 | 211 | 79 | import | false |
| 455 | 211 | 352 | import | false |
| 456 | 214 | 29 | import | true |
| 457 | 214 | 393 | import | true |
| 458 | 215 | 168 | import | true |
| 459 | 215 | 297 | import | false |
| 460 | 216 | 351 | import | false |
| 461 | 219 | 388 | import | false |
| 462 | 219 | 393 | import | false |
| 463 | 223 | 393 | import | false |
| 464 | 225 | 10 | import | false |
| 465 | 225 | 416 | import | false |
| 466 | 226 | 46 | import | false |
| 467 | 226 | 132 | import | false |
| 468 | 226 | 168 | import | true |
| 469 | 226 | 393 | import | true |
| 470 | 226 | 430 | import | false |
| 471 | 226 | 502 | import | false |
| 472 | 227 | 168 | import | true |
| 473 | 227 | 197 | import | false |
| 474 | 228 | 29 | import | true |
| 475 | 228 | 214 | import | true |
| 476 | 228 | 231 | import | false |
| 477 | 228 | 313 | import | false |
| 478 | 228 | 339 | import | false |
| 479 | 228 | 359 | import | false |
| 480 | 228 | 393 | import | false |
| 481 | 228 | 394 | import | false |
| 482 | 228 | 426 | import | false |
| 483 | 228 | 472 | import | false |
| 484 | 231 | 10 | import | false |
| 485 | 231 | 29 | import | true |
| 486 | 231 | 214 | import | false |
| 487 | 231 | 393 | import | false |
| 488 | 235 | 29 | import | false |
| 489 | 235 | 334 | import | false |
| 490 | 236 | 395 | import | false |
| 491 | 238 | 266 | import | false |
| 492 | 238 | 323 | import | false |
| 493 | 238 | 333 | import | false |
| 494 | 238 | 365 | import | false |
| 495 | 238 | 387 | import | false |
| 496 | 238 | 393 | import | true |
| 497 | 238 | 406 | import | false |
| 498 | 238 | 424 | import | false |
| 499 | 238 | 459 | import | false |
| 500 | 239 | 393 | import | true |
| 501 | 241 | 32 | import | false |
| 502 | 241 | 41 | import | true |
| 503 | 241 | 94 | import | false |
| 504 | 241 | 386 | import | false |
| 505 | 243 | 165 | import | false |
| 506 | 244 | 10 | import | false |
| 507 | 244 | 28 | import | false |
| 508 | 244 | 29 | import | false |
| 509 | 244 | 48 | import | false |
| 510 | 244 | 141 | import | false |
| 511 | 244 | 178 | import | false |
| 512 | 244 | 179 | import | false |
| 513 | 244 | 214 | import | false |
| 514 | 244 | 225 | import | false |
| 515 | 244 | 272 | import | false |
| 516 | 244 | 428 | import | false |
| 517 | 244 | 429 | import | false |
| 518 | 244 | 441 | import | false |
| 519 | 244 | 468 | import | false |
| 520 | 244 | 479 | import | false |
| 521 | 244 | 500 | import | false |
| 522 | 245 | 377 | import | false |
| 523 | 245 | 393 | import | true |
| 524 | 246 | 28 | import | false |
| 525 | 246 | 48 | import | false |
| 526 | 246 | 53 | import | false |
| 527 | 246 | 63 | import | false |
| 528 | 246 | 141 | import | false |
| 529 | 246 | 178 | import | false |
| 530 | 246 | 225 | import | false |
| 531 | 246 | 428 | import | false |
| 532 | 246 | 429 | import | false |
| 533 | 246 | 441 | import | false |
| 534 | 246 | 468 | import | false |
| 535 | 246 | 479 | import | false |
| 536 | 246 | 500 | import | false |
| 537 | 246 | 501 | import | false |
| 538 | 247 | 433 | import | false |
| 539 | 248 | 196 | import | false |
| 540 | 248 | 427 | import | false |
| 541 | 249 | 144 | import | false |
| 542 | 253 | 98 | import | false |
| 543 | 253 | 338 | import | false |
| 544 | 254 | 315 | import | false |
| 545 | 255 | 121 | import | false |
| 546 | 258 | 99 | import | false |
| 547 | 258 | 215 | import | false |
| 548 | 258 | 297 | import | false |
| 549 | 258 | 328 | import | false |
| 550 | 258 | 354 | import | false |
| 551 | 259 | 29 | import | true |
| 552 | 259 | 472 | import | true |
| 553 | 266 | 323 | import | false |
| 554 | 267 | 461 | import | false |
| 555 | 268 | 393 | import | true |
| 556 | 268 | 480 | import | false |
| 557 | 271 | 351 | import | false |
| 558 | 272 | 351 | import | false |
| 559 | 272 | 435 | import | false |
| 560 | 276 | 29 | import | false |
| 561 | 276 | 417 | import | false |
| 562 | 277 | 480 | import | false |
| 563 | 280 | 73 | import | false |
| 564 | 280 | 375 | import | false |
| 565 | 280 | 418 | import | false |
| 566 | 280 | 464 | import | false |
| 567 | 282 | 351 | import | false |
| 568 | 283 | 29 | import | false |
| 569 | 283 | 47 | import | false |
| 570 | 283 | 271 | import | false |
| 571 | 283 | 317 | import | false |
| 572 | 283 | 351 | import | false |
| 573 | 283 | 468 | import | false |
| 574 | 285 | 393 | import | true |
| 575 | 288 | 16 | import | false |
| 576 | 288 | 89 | import | false |
| 577 | 288 | 344 | import | false |
| 578 | 288 | 352 | import | false |
| 579 | 288 | 493 | import | false |
| 580 | 290 | 198 | import | false |
| 581 | 290 | 323 | import | false |
| 582 | 290 | 493 | import | false |
| 583 | 291 | 20 | import | false |
| 584 | 291 | 29 | import | false |
| 585 | 291 | 47 | import | false |
| 586 | 291 | 68 | import | false |
| 587 | 291 | 150 | import | false |
| 588 | 291 | 184 | import | false |
| 589 | 291 | 216 | import | false |
| 590 | 291 | 271 | import | false |
| 591 | 291 | 272 | import | false |
| 592 | 291 | 309 | import | false |
| 593 | 291 | 334 | import | false |
| 594 | 291 | 339 | import | false |
| 595 | 291 | 351 | import | false |
| 596 | 291 | 393 | import | false |
| 597 | 291 | 441 | import | false |
| 598 | 291 | 470 | import | false |
| 599 | 291 | 475 | import | false |
| 600 | 292 | 186 | import | false |
| 601 | 292 | 388 | import | false |
| 602 | 292 | 393 | import | false |
| 603 | 293 | 168 | import | true |
| 604 | 299 | 201 | import | false |
| 605 | 299 | 323 | import | false |
| 606 | 299 | 382 | import | false |
| 607 | 299 | 393 | import | false |
| 608 | 299 | 493 | import | false |
| 609 | 300 | 168 | import | true |
| 610 | 301 | 25 | import | false |
| 611 | 301 | 28 | import | false |
| 612 | 301 | 29 | import | false |
| 613 | 301 | 48 | import | false |
| 614 | 301 | 81 | import | false |
| 615 | 301 | 141 | import | false |
| 616 | 301 | 154 | import | false |
| 617 | 301 | 178 | import | false |
| 618 | 301 | 225 | import | false |
| 619 | 301 | 351 | import | false |
| 620 | 301 | 393 | import | true |
| 621 | 301 | 415 | import | false |
| 622 | 301 | 428 | import | false |
| 623 | 301 | 429 | import | false |
| 624 | 301 | 441 | import | false |
| 625 | 301 | 468 | import | false |
| 626 | 301 | 479 | import | false |
| 627 | 301 | 500 | import | false |
| 628 | 302 | 351 | import | false |
| 629 | 307 | 293 | import | false |
| 630 | 308 | 186 | import | false |
| 631 | 308 | 388 | import | false |
| 632 | 309 | 29 | import | false |
| 633 | 309 | 350 | import | false |
| 634 | 309 | 393 | import | true |
| 635 | 310 | 29 | import | false |
| 636 | 310 | 35 | import | false |
| 637 | 310 | 47 | import | false |
| 638 | 310 | 184 | import | false |
| 639 | 310 | 216 | import | false |
| 640 | 310 | 351 | import | false |
| 641 | 310 | 393 | import | true |
| 642 | 310 | 470 | import | false |
| 643 | 310 | 490 | import | false |
| 644 | 312 | 329 | import | false |
| 645 | 312 | 365 | import | false |
| 646 | 313 | 29 | import | false |
| 647 | 313 | 271 | import | false |
| 648 | 313 | 441 | import | false |
| 649 | 313 | 470 | import | false |
| 650 | 313 | 472 | import | true |
| 651 | 314 | 329 | import | false |
| 652 | 316 | 351 | import | false |
| 653 | 317 | 29 | import | false |
| 654 | 320 | 351 | import | false |
| 655 | 323 | 55 | import | false |
| 656 | 323 | 121 | import | true |
| 657 | 323 | 136 | import | true |
| 658 | 323 | 138 | import | true |
| 659 | 323 | 165 | import | false |
| 660 | 323 | 168 | import | true |
| 661 | 323 | 197 | import | false |
| 662 | 323 | 201 | import | false |
| 663 | 323 | 215 | import | false |
| 664 | 323 | 223 | import | false |
| 665 | 323 | 226 | import | false |
| 666 | 323 | 255 | import | false |
| 667 | 323 | 285 | import | false |
| 668 | 323 | 293 | import | false |
| 669 | 323 | 333 | import | false |
| 670 | 323 | 342 | import | false |
| 671 | 323 | 365 | import | false |
| 672 | 323 | 377 | import | false |
| 673 | 323 | 392 | import | true |
| 674 | 323 | 393 | import | false |
| 675 | 324 | 371 | import | false |
| 676 | 327 | 386 | import | false |
| 677 | 328 | 297 | import | false |
| 678 | 333 | 393 | import | false |
| 679 | 334 | 29 | import | false |
| 680 | 334 | 309 | import | false |
| 681 | 335 | 10 | import | false |
| 682 | 335 | 29 | import | false |
| 683 | 335 | 154 | import | false |
| 684 | 335 | 283 | import | false |
| 685 | 335 | 351 | import | false |
| 686 | 335 | 393 | import | true |
| 687 | 335 | 415 | import | false |
| 688 | 335 | 441 | import | false |
| 689 | 335 | 468 | import | false |
| 690 | 338 | 11 | import | false |
| 691 | 338 | 16 | import | false |
| 692 | 338 | 52 | import | false |
| 693 | 338 | 74 | import | false |
| 694 | 338 | 133 | import | false |
| 695 | 338 | 193 | import | false |
| 696 | 338 | 198 | import | false |
| 697 | 338 | 268 | import | false |
| 698 | 338 | 323 | import | false |
| 699 | 338 | 333 | import | false |
| 700 | 338 | 365 | import | false |
| 701 | 338 | 384 | import | false |
| 702 | 338 | 392 | import | false |
| 703 | 338 | 393 | import | false |
| 704 | 339 | 74 | import | false |
| 705 | 339 | 214 | import | true |
| 706 | 339 | 393 | import | true |
| 707 | 342 | 45 | import | false |
| 708 | 342 | 168 | import | true |
| 709 | 342 | 377 | import | false |
| 710 | 342 | 393 | import | true |
| 711 | 343 | 131 | import | false |
| 712 | 344 | 226 | import | false |
| 713 | 344 | 493 | import | false |
| 714 | 345 | 29 | import | true |
| 715 | 345 | 393 | import | true |
| 716 | 346 | 247 | import | false |
| 717 | 350 | 29 | import | false |
| 718 | 350 | 268 | import | false |
| 719 | 350 | 276 | import | false |
| 720 | 350 | 393 | import | false |
| 721 | 352 | 79 | import | false |
| 722 | 352 | 99 | import | false |
| 723 | 352 | 226 | import | false |
| 724 | 352 | 238 | import | false |
| 725 | 352 | 263 | import | false |
| 726 | 352 | 323 | import | false |
| 727 | 352 | 333 | import | false |
| 728 | 352 | 338 | import | false |
| 729 | 352 | 387 | import | false |
| 730 | 352 | 393 | import | true |
| 731 | 352 | 406 | import | false |
| 732 | 352 | 493 | import | false |
| 733 | 353 | 217 | import | false |
| 734 | 355 | 327 | import | false |
| 735 | 355 | 386 | import | false |
| 736 | 356 | 98 | import | false |
| 737 | 356 | 198 | import | false |
| 738 | 356 | 323 | import | false |
| 739 | 357 | 22 | require | false |
| 740 | 358 | 4 | import | false |
| 741 | 359 | 10 | import | false |
| 742 | 359 | 29 | import | false |
| 743 | 359 | 207 | import | false |
| 744 | 359 | 231 | import | false |
| 745 | 359 | 351 | import | false |
| 746 | 359 | 393 | import | false |
| 747 | 359 | 426 | import | false |
| 748 | 359 | 441 | import | false |
| 749 | 359 | 472 | import | false |
| 750 | 361 | 130 | import | false |
| 751 | 361 | 351 | import | false |
| 752 | 362 | 72 | import | false |
| 753 | 362 | 105 | import | false |
| 754 | 362 | 335 | import | false |
| 755 | 362 | 491 | import | false |
| 756 | 364 | 186 | import | false |
| 757 | 364 | 308 | import | false |
| 758 | 364 | 388 | import | false |
| 759 | 364 | 393 | import | true |
| 760 | 369 | 193 | import | false |
| 761 | 369 | 323 | import | false |
| 762 | 369 | 338 | import | false |
| 763 | 372 | 74 | import | false |
| 764 | 372 | 201 | import | false |
| 765 | 372 | 323 | import | false |
| 766 | 372 | 382 | import | false |
| 767 | 372 | 493 | import | false |
| 768 | 377 | 168 | import | true |
| 769 | 377 | 393 | import | true |
| 770 | 382 | 393 | import | true |
| 771 | 384 | 16 | import | false |
| 772 | 384 | 323 | import | true |
| 773 | 384 | 493 | import | false |
| 774 | 387 | 333 | import | false |
| 775 | 388 | 393 | import | false |
| 776 | 391 | 432 | import | false |
| 777 | 394 | 29 | import | false |
| 778 | 394 | 351 | import | false |
| 779 | 394 | 359 | import | false |
| 780 | 394 | 441 | import | false |
| 781 | 394 | 472 | import | false |
| 782 | 395 | 212 | import | false |
| 783 | 396 | 58 | import | false |
| 784 | 396 | 382 | import | false |
| 785 | 398 | 351 | import | false |
| 786 | 406 | 323 | import | true |
| 787 | 410 | 345 | import | false |
| 788 | 410 | 393 | import | true |
| 789 | 411 | 25 | import | false |
| 790 | 411 | 28 | import | false |
| 791 | 411 | 29 | import | false |
| 792 | 411 | 141 | import | false |
| 793 | 411 | 178 | import | false |
| 794 | 411 | 225 | import | false |
| 795 | 411 | 393 | import | true |
| 796 | 411 | 415 | import | false |
| 797 | 411 | 428 | import | false |
| 798 | 411 | 429 | import | false |
| 799 | 411 | 441 | import | false |
| 800 | 411 | 479 | import | false |
| 801 | 411 | 500 | import | false |
| 802 | 411 | 501 | import | false |
| 803 | 414 | 323 | import | false |
| 804 | 414 | 493 | import | false |
| 805 | 415 | 47 | import | false |
| 806 | 416 | 10 | import | true |
| 807 | 416 | 29 | import | false |
| 808 | 417 | 393 | import | false |
| 809 | 418 | 20 | import | false |
| 810 | 418 | 29 | import | false |
| 811 | 418 | 35 | import | false |
| 812 | 418 | 47 | import | false |
| 813 | 418 | 68 | import | false |
| 814 | 418 | 119 | import | false |
| 815 | 418 | 150 | import | false |
| 816 | 418 | 184 | import | false |
| 817 | 418 | 239 | import | false |
| 818 | 418 | 271 | import | false |
| 819 | 418 | 276 | import | true |
| 820 | 418 | 309 | import | false |
| 821 | 418 | 310 | import | false |
| 822 | 418 | 339 | import | true |
| 823 | 418 | 351 | import | false |
| 824 | 418 | 393 | import | true |
| 825 | 418 | 435 | import | false |
| 826 | 418 | 441 | import | false |
| 827 | 418 | 452 | import | false |
| 828 | 418 | 499 | import | false |
| 829 | 419 | 29 | import | false |
| 830 | 419 | 80 | import | false |
| 831 | 419 | 130 | import | false |
| 832 | 419 | 184 | import | false |
| 833 | 419 | 239 | import | false |
| 834 | 419 | 393 | import | true |
| 835 | 419 | 441 | import | false |
| 836 | 420 | 201 | import | false |
| 837 | 420 | 382 | import | false |
| 838 | 421 | 29 | import | false |
| 839 | 421 | 73 | import | false |
| 840 | 421 | 77 | import | false |
| 841 | 421 | 80 | import | false |
| 842 | 421 | 102 | import | false |
| 843 | 421 | 158 | import | false |
| 844 | 421 | 182 | import | false |
| 845 | 421 | 200 | import | false |
| 846 | 421 | 216 | import | false |
| 847 | 421 | 235 | import | false |
| 848 | 421 | 239 | import | false |
| 849 | 421 | 276 | import | false |
| 850 | 421 | 280 | import | false |
| 851 | 421 | 282 | import | false |
| 852 | 421 | 334 | import | false |
| 853 | 421 | 350 | import | false |
| 854 | 421 | 351 | import | false |
| 855 | 421 | 375 | import | false |
| 856 | 421 | 393 | import | false |
| 857 | 421 | 398 | import | false |
| 858 | 421 | 416 | import | false |
| 859 | 421 | 417 | import | false |
| 860 | 421 | 419 | import | false |
| 861 | 421 | 423 | import | false |
| 862 | 421 | 439 | import | false |
| 863 | 422 | 5 | import | false |
| 864 | 422 | 11 | import | false |
| 865 | 422 | 168 | import | true |
| 866 | 422 | 201 | import | false |
| 867 | 422 | 388 | import | false |
| 868 | 422 | 393 | import | false |
| 869 | 424 | 89 | import | false |
| 870 | 424 | 266 | import | true |
| 871 | 424 | 352 | import | false |
| 872 | 425 | 351 | import | false |
| 873 | 426 | 68 | import | false |
| 874 | 426 | 214 | import | true |
| 875 | 426 | 231 | import | false |
| 876 | 426 | 339 | import | false |
| 877 | 426 | 393 | import | false |
| 878 | 426 | 441 | import | false |
| 879 | 427 | 196 | import | false |
| 880 | 428 | 351 | import | false |
| 881 | 429 | 25 | import | false |
| 882 | 429 | 56 | import | false |
| 883 | 429 | 271 | import | false |
| 884 | 429 | 351 | import | false |
| 885 | 429 | 435 | import | false |
| 886 | 429 | 441 | import | false |
| 887 | 435 | 351 | import | false |
| 888 | 439 | 29 | import | false |
| 889 | 439 | 47 | import | false |
| 890 | 439 | 184 | import | false |
| 891 | 439 | 309 | import | false |
| 892 | 439 | 393 | import | true |
| 893 | 439 | 441 | import | false |
| 894 | 439 | 470 | import | false |
| 895 | 440 | 136 | import | false |
| 896 | 440 | 168 | import | true |
| 897 | 440 | 342 | import | false |
| 898 | 445 | 98 | import | false |
| 899 | 445 | 136 | import | false |
| 900 | 445 | 165 | import | false |
| 901 | 445 | 197 | import | false |
| 902 | 445 | 198 | import | false |
| 903 | 445 | 323 | import | false |
| 904 | 445 | 342 | import | false |
| 905 | 445 | 377 | import | false |
| 906 | 446 | 198 | import | false |
| 907 | 446 | 323 | import | false |
| 908 | 446 | 333 | import | false |
| 909 | 446 | 393 | import | false |
| 910 | 449 | 254 | import | false |
| 911 | 449 | 271 | import | false |
| 912 | 449 | 416 | import | false |
| 913 | 449 | 421 | import | false |
| 914 | 452 | 232 | import | false |
| 915 | 452 | 239 | import | false |
| 916 | 452 | 351 | import | false |
| 917 | 452 | 499 | import | true |
| 918 | 459 | 266 | import | true |
| 919 | 459 | 338 | import | false |
| 920 | 461 | 155 | import | false |
| 921 | 464 | 351 | import | false |
| 922 | 467 | 268 | import | false |
| 923 | 468 | 10 | import | false |
| 924 | 468 | 29 | import | true |
| 925 | 468 | 214 | import | false |
| 926 | 468 | 393 | import | false |
| 927 | 468 | 441 | import | false |
| 928 | 470 | 351 | import | false |
| 929 | 472 | 10 | import | false |
| 930 | 472 | 29 | import | true |
| 931 | 472 | 131 | import | false |
| 932 | 472 | 214 | import | false |
| 933 | 472 | 268 | import | false |
| 934 | 472 | 337 | import | false |
| 935 | 472 | 345 | import | false |
| 936 | 472 | 498 | import | false |
| 937 | 473 | 98 | import | false |
| 938 | 473 | 198 | import | false |
| 939 | 473 | 323 | import | false |
| 940 | 473 | 338 | import | false |
| 941 | 475 | 29 | import | false |
| 942 | 475 | 351 | import | false |
| 943 | 475 | 470 | import | false |
| 944 | 477 | 1 | import | false |
| 945 | 479 | 351 | import | false |
| 946 | 482 | 351 | import | false |
| 947 | 484 | 79 | import | false |
| 948 | 484 | 352 | import | false |
| 949 | 484 | 393 | import | true |
| 950 | 487 | 98 | import | false |
| 951 | 490 | 351 | import | false |
| 952 | 491 | 48 | import | false |
| 953 | 491 | 225 | import | false |
| 954 | 491 | 283 | import | false |
| 955 | 491 | 351 | import | false |
| 956 | 491 | 441 | import | false |
| 957 | 491 | 468 | import | false |
| 958 | 491 | 479 | import | false |
| 959 | 491 | 500 | import | false |
| 960 | 493 | 46 | import | false |
| 961 | 493 | 74 | import | false |
| 962 | 493 | 136 | import | false |
| 963 | 493 | 144 | import | false |
| 964 | 493 | 263 | import | false |
| 965 | 493 | 285 | import | false |
| 966 | 493 | 344 | import | true |
| 967 | 493 | 393 | import | false |
| 968 | 495 | 91 | import | false |
| 969 | 495 | 196 | import | false |
| 970 | 495 | 434 | import | false |
| 971 | 498 | 214 | import | false |
| 972 | 498 | 441 | import | false |
| 973 | 499 | 393 | import | true |
| 974 | 500 | 351 | import | false |
| 975 | 500 | 415 | import | false |
| 976 | 501 | 10 | import | false |
| 977 | 503 | 338 | import | false |
| 978 | 503 | 407 | import | false |
