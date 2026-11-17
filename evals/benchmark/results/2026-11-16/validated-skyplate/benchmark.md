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
Nothing was sent anywhere; sharing this file is your decision.

- format: skyplate-benchmark
- version: 1

## privacy

- level: aggregate
- coarsening: power-of-two
- durations: two-significant-figures
- ratios: hundredths
- retainsShape: false

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
| workers | 0 |
| exclude_count | 0 |

## scale


### totals

| code | value |
| --- | --- |
| files | 512 |
| dirs | 64 |
| bytes | 4194304 |
| lines | 131072 |
| code | 65536 |
| comment | 16384 |
| blank | 8192 |
| binaryFiles | 0 |
| generatedFiles | 8 |
| vendoredFiles | 16 |
| ignored | 8 |
| languages | 16 |
| secrets | 0 |

### languages

| language | totals | diagnostics |
| --- | --- | --- |
| css | files 2 · bytes 16384 · lines 512 · code 256 · comment 128 · blank 32 | extension 2 |
| html | files 8 · bytes 131072 · lines 1024 · code 1024 · comment 32 · blank 4 | heuristic 8 |
| ignore-list | files 1 · bytes 1024 · lines 64 · code 32 · comment 16 · blank 16 | filename 1 |
| javascript | files 1 · bytes 512 · lines 32 · code 8 · comment 8 · blank 2 | extension 1 |
| json | files 8 · bytes 262144 · lines 4096 · code 2048 · comment 0 · blank 512 | heuristic 8 · filename 1 |
| json-with-comments | files 2 · bytes 2048 · lines 64 · code 64 · comment 8 · blank 8 | filename 2 |
| markdown | files 16 · bytes 262144 · lines 4096 · code 2048 · comment 4 · blank 512 | heuristic 16 |
| svg | files 4 · bytes 16384 · lines 16 · code 16 · comment 2 · blank 0 | extension 4 |
| text | files 8 · bytes 131072 · lines 2048 · code 2048 · comment 0 · blank 512 | filename 2 · fallback 8 |
| toml | files 1 · bytes 256 · lines 16 · code 8 · comment 4 · blank 4 | extension 1 |
| tsx | files 128 · bytes 1048576 · lines 16384 · code 16384 · comment 2048 · blank 1024 | heuristic 128 |
| typescript | files 256 · bytes 4194304 · lines 65536 · code 65536 · comment 8192 · blank 4096 | heuristic 256 |
| yaml | files 4 · bytes 4096 · lines 64 · code 64 · comment 16 · blank 4 | heuristic 4 |

### categories

| category | totals |
| --- | --- |
| code | files 256 · bytes 4194304 · lines 65536 |
| test | files 64 · bytes 524288 · lines 16384 |
| docs | files 16 · bytes 262144 · lines 4096 |
| config | files 16 · bytes 65536 · lines 2048 |
| markup | files 8 · bytes 131072 · lines 1024 |
| unknown | files 8 · bytes 131072 · lines 2048 |
| image | files 4 · bytes 16384 · lines 16 |
| style | files 2 · bytes 16384 · lines 512 |
| build | files 1 · bytes 4096 · lines 64 |
| data | files 1 · bytes 1024 · lines 64 |
| lockfile | files 1 · bytes 131072 · lines 1024 |

### distributions

| metric | count | minimum | p50 | p90 | p99 | maximum | histogram |
| --- | --- | --- | --- | --- | --- | --- | --- |
| file_bytes | 512 | 128 | 8192 | 32768 | 131072 | 262144 | ≤128: 4 · ≤256: 8 · ≤512: 16 · ≤1024: 32 · ≤2048: 32 · ≤4096: 64 · ≤8192: 64 · ≤16384: 64 · ≤32768: 64 · ≤65536: 32 · ≤131072: 8 · ≤262144: 1 |
| file_lines | 512 | 1 | 256 | 1024 | 2048 | 4096 | ≤1: 2 · ≤2: 1 · ≤4: 4 · ≤8: 8 · ≤16: 8 · ≤32: 32 · ≤64: 64 · ≤128: 64 · ≤256: 64 · ≤512: 64 · ≤1024: 32 · ≤2048: 16 · ≤4096: 1 |
| file_depth | 512 | 0 | 4 | 4 | 4 | 4 | ≤0: 16 · ≤1: 64 · ≤2: 64 · ≤4: 256 |
| directory_fanout | 64 | 1 | 4 | 32 | 32 | 32 | ≤1: 16 · ≤2: 8 · ≤4: 16 · ≤8: 16 · ≤16: 4 · ≤32: 8 |
| fanIn | 512 | 0 | 1 | 8 | 64 | 128 | ≤0: 128 · ≤1: 64 · ≤2: 64 · ≤4: 64 · ≤8: 32 · ≤16: 32 · ≤32: 2 · ≤64: 4 · ≤128: 1 |
| fanOut | 512 | 0 | 1 | 16 | 32 | 32 | ≤0: 128 · ≤1: 64 · ≤2: 64 · ≤4: 64 · ≤8: 64 · ≤16: 32 · ≤32: 16 |
| symbols_per_file | 512 | 0 | 8 | 64 | 256 | 512 | ≤0: 64 · ≤1: 8 · ≤2: 32 · ≤4: 32 · ≤8: 64 · ≤16: 64 · ≤32: 64 · ≤64: 32 · ≤128: 16 · ≤256: 8 · ≤512: 1 |
| references_per_symbol | 8192 | 0 | 4 | 16 | 64 | 512 | ≤0: 512 · ≤1: 2048 · ≤2: 1024 · ≤4: 1024 · ≤8: 1024 · ≤16: 512 · ≤32: 256 · ≤64: 128 · ≤128: 32 · ≤256: 16 · ≤512: 4 |
| commits_per_file | 512 | 0 | 2 | 8 | 8 | 16 | ≤0: 32 · ≤1: 128 · ≤2: 64 · ≤4: 128 · ≤8: 32 · ≤16: 2 |
| authors_per_file | 512 | 0 | 1 | 1 | 1 | 1 | ≤0: 32 · ≤1: 512 |
| age_days | 512 | 8 | 32 | 32 | 32 | 32 | ≤8: 32 · ≤16: 64 · ≤32: 256 |
| cycle_size | 1 | 4 | 4 | 4 | 4 | 4 | ≤4: 1 |

## cost

- totalMs: 1400
- samplingMs: 100

### phases

| phase | status | ms | filesPerSecond | bytesPerSecond |
| --- | --- | --- | --- | --- |
| walk | ok | 13 | 32768 | 268435456 |
| detect | ok | 30 | 16384 | 134217728 |
| files | ok | 98 | 4096 | 67108864 |
| imports | ok | 18 | 16384 | 268435456 |
| graph | ok | 8 | 65536 | 536870912 |
| git | ok | 210 | 2048 | 16777216 |
| layout | ok | 130 | 4096 | 33554432 |
| typescript | ok | 1300 | 256 | 4194304 |
| stats | ok | 1 | 524288 | 4294967296 |
| findings | ok | 3 | 131072 | 2147483648 |

### memory

| phase | status | rss | heap |
| --- | --- | --- | --- |
| walk | start | 33554432 | 8388608 |
| walk | done | 33554432 | 8388608 |
| detect | start | 33554432 | 8388608 |
| detect | done | 268435456 | 8388608 |
| git | start | 268435456 | 8388608 |
| typescript | start | 268435456 | 8388608 |
| files | start | 268435456 | 8388608 |
| files | done | 268435456 | 16777216 |
| imports | start | 268435456 | 16777216 |
| imports | done | 268435456 | 16777216 |
| graph | start | 268435456 | 16777216 |
| graph | done | 268435456 | 16777216 |
| layout | start | 268435456 | 16777216 |
| git | done | 268435456 | 33554432 |
| layout | done | 536870912 | 134217728 |
| typescript | done | 536870912 | 268435456 |
| stats | start | 536870912 | 268435456 |
| stats | done | 536870912 | 268435456 |
| findings | start | 536870912 | 268435456 |
| findings | done | 536870912 | 268435456 |

### totals

| code | value |
| --- | --- |
| peak_rss | 536870912 |
| peak_heap | 268435456 |
| high_water_rss | 536870912 |

### workers

| code | value |
| --- | --- |
| size | 16 |
| submitted | 64 |
| completed | 64 |
| failed | 0 |
| spawned | 16 |
| queuePeak | 16 |
| busyPeak | 16 |
| waitMs | 1024 |
| runMs | 1024 |

### payloads

| code | value |
| --- | --- |
| report | 262144 |
| symbols_payload | 2097152 |
| source_chunk | 2097152 |
| source_chunk | 2097152 |
| source_chunk | 524288 |
| assets | 16384 |

### layout

| ms | budgetMs | siblingBudgetMs | exceeded |
| --- | --- | --- | --- |
| 2 | 150 | 0 | false |

## quality

- errors: none
- validation: none

### imports

| language | internal | external | unresolved | unresolvedShare | shapes |
| --- | --- | --- | --- | --- | --- |
| typescript | 512 | 256 | 1 | 0 | relative 1 |
| tsx | 512 | 256 | 0 | 0 | none |
| css | 1 | 2 | 0 | 0 | none |
| javascript | 1 | 0 | 0 | 0 | none |

### rates

| code | value |
| --- | --- |
| ts_coverage | 1 |
| ts_unresolved_share | 0.02 |
| unused_export_share | 0.21 |

### typescript

| code | value |
| --- | --- |
| present | 256 |
| eligible | 256 |
| covered | 256 |
| projects | 2 |
| references | 32768 |
| symbols | 8192 |
| unresolved | 1024 |
| uninstalledManifests | 0 |
| hostFiles | 0 |

### unusedExports

| code | value |
| --- | --- |
| exports | 2048 |
| unusedExports | 256 |
| used-in-own-file | 256 |
| entry-export | 8 |
| unreferenced | 64 |

### entryPoints

| code | value |
| --- | --- |
| package bin | 1 |
| package script | 2 |
| type declarations | 4 |

### cycles

| code | value |
| --- | --- |
| runtime_cycles | 1 |
| type_cycles | 4 |

### diagnostics

| code | value |
| --- | --- |
| warnings_total | 0 |

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
| source_binary_disabled | 0 |
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
| source_file_cap | 0 |
| source_total_cap | 0 |
| source_disabled | 0 |

## queries

| tool | rank | status | ms | responseBytes | tokens | truncated | error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| overview | cold | ok | 0.4 | 4096 | 1024 | 0 | none |
| map_codebase | cold | ok | 2.1 | 8192 | 2048 | 0 | none |
| locate_code | top_hotspot | ok | 3 | 4096 | 1024 | 0 | none |
| change_impact | top_hotspot | ok | 3.4 | 4096 | 1024 | 0 | none |
| change_impact | most_referenced | ok | 0.75 | 8192 | 2048 | 0 | none |
| files | top_hotspot | ok | 0.43 | 16384 | 4096 | 256 | none |
| dir | largest_directory | ok | 0.37 | 4096 | 1024 | 0 | none |
| dir | median_directory | ok | 0.06 | 4096 | 1024 | 0 | none |
| file | top_hotspot | ok | 0.31 | 8192 | 2048 | 0 | none |
| file | median_file | ok | 0.045 | 2048 | 512 | 0 | none |
| symbol | most_referenced | ok | 0.82 | 8192 | 2048 | 512 | none |
| search_symbols | most_referenced | ok | 0.81 | 8192 | 2048 | 256 | none |
| seams | cold | ok | 3.8 | 16384 | 4096 | 0 | none |
| seam | largest_directory | ok | 5.4 | 16384 | 4096 | 2048 | none |
| seam | median_directory | ok | 2.8 | 8192 | 2048 | 512 | none |
| graph | top_hotspot | ok | 0.19 | 1024 | 256 | 0 | none |
| history | cold | ok | 0.17 | 512 | 128 | 0 | none |
| dependencies | cold | ok | 0.11 | 8192 | 2048 | 8 | none |
| overview | warm | ok | 0.16 | 4096 | 1024 | 0 | none |

## anomalies

None.

## failures

None.

## session

- calls: none
- transitions: none
