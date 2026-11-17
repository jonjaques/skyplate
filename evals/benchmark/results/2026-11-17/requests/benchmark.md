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
| files | 128 |
| dirs | 32 |
| bytes | 8388608 |
| lines | 32768 |
| code | 16384 |
| comment | 4096 |
| blank | 4096 |
| binaryFiles | 8 |
| generatedFiles | 0 |
| vendoredFiles | 8 |
| ignored | 2 |
| languages | 32 |
| secrets | 4 |

### languages

| language | totals | diagnostics |
| --- | --- | --- |
| batchfile | files 1 · bytes 8192 · lines 512 · code 256 · comment 2 · blank 64 | extension 1 |
| binary | files 8 · bytes 4194304 · lines 0 · code 0 · comment 0 · blank 0 | content 8 |
| codeowners | files 1 · bytes 512 · lines 8 · code 8 · comment 2 · blank 1 | filename 1 |
| css | files 1 · bytes 512 · lines 16 · code 8 · comment 0 · blank 4 | extension 1 |
| git-revision-list | files 1 · bytes 256 · lines 8 · code 4 · comment 0 · blank 1 | filename 1 |
| html | files 1 · bytes 2048 · lines 64 · code 32 · comment 0 · blank 8 | heuristic 1 |
| ignore-list | files 2 · bytes 512 · lines 64 · code 64 · comment 1 · blank 8 | filename 2 |
| ini | files 8 · bytes 4096 · lines 128 · code 128 · comment 4 · blank 16 | filename 1 · extension 8 |
| makefile | files 8 · bytes 16384 · lines 512 · code 512 · comment 8 · blank 64 | filename 8 |
| markdown | files 16 · bytes 131072 · lines 4096 · code 2048 · comment 8 · blank 1024 | heuristic 16 |
| pip-requirements | files 2 · bytes 256 · lines 16 · code 8 · comment 2 · blank 0 | filename 2 |
| python | files 64 · bytes 524288 · lines 16384 · code 8192 · comment 4096 · blank 4096 | extension 64 |
| restructuredtext | files 16 · bytes 131072 · lines 4096 · code 4096 · comment 0 · blank 1024 | extension 16 |
| svg | files 1 · bytes 1048576 · lines 1 · code 1 · comment 0 · blank 0 | extension 1 |
| text | files 32 · bytes 32768 · lines 1024 · code 1024 · comment 0 · blank 64 | filename 8 · fallback 16 |
| toml | files 1 · bytes 4096 · lines 128 · code 128 · comment 2 · blank 16 | extension 1 |
| yaml | files 16 · bytes 16384 · lines 512 · code 512 · comment 64 · blank 64 | heuristic 16 |

### categories

| category | totals |
| --- | --- |
| test | files 64 · bytes 262144 · lines 8192 |
| docs | files 32 · bytes 4194304 · lines 8192 |
| code | files 32 · bytes 262144 · lines 8192 |
| config | files 32 · bytes 16384 · lines 512 |
| build | files 16 · bytes 32768 · lines 1024 |
| image | files 8 · bytes 2097152 · lines 1 |
| style | files 1 · bytes 512 · lines 16 |

### distributions

| metric | count | minimum | p50 | p90 | p99 | maximum | histogram |
| --- | --- | --- | --- | --- | --- | --- | --- |
| file_bytes | 128 | 0 | 2048 | 32768 | 1048576 | 4194304 | ≤0: 2 · ≤1: 1 · ≤32: 1 · ≤64: 8 · ≤128: 4 · ≤256: 16 · ≤512: 32 · ≤1024: 16 · ≤2048: 16 · ≤4096: 32 · ≤8192: 16 · ≤16384: 8 · ≤32768: 4 · ≤65536: 8 · ≤131072: 1 · ≤262144: 2 · ≤524288: 1 · ≤1048576: 1 · ≤4194304: 1 |
| file_lines | 128 | 0 | 32 | 512 | 4096 | 4096 | ≤0: 8 · ≤1: 8 · ≤2: 2 · ≤4: 8 · ≤8: 8 · ≤16: 16 · ≤32: 32 · ≤64: 16 · ≤128: 16 · ≤256: 16 · ≤512: 8 · ≤1024: 8 · ≤2048: 4 · ≤4096: 2 |
| file_depth | 128 | 0 | 2 | 4 | 4 | 4 | ≤0: 16 · ≤1: 64 · ≤2: 64 · ≤4: 32 |
| directory_fanout | 32 | 1 | 8 | 16 | 32 | 32 | ≤1: 4 · ≤2: 4 · ≤4: 8 · ≤8: 8 · ≤16: 4 · ≤32: 2 |
| fanIn | 128 | 0 | 0 | 4 | 16 | 16 | ≤0: 128 · ≤1: 4 · ≤2: 4 · ≤4: 8 · ≤8: 8 · ≤16: 4 |
| fanOut | 128 | 0 | 0 | 2 | 16 | 16 | ≤0: 128 · ≤1: 16 · ≤2: 4 · ≤4: 4 · ≤8: 4 · ≤16: 4 |
| symbols_per_file | 128 | 0 | 0 | 0 | 0 | 0 | ≤0: 128 |
| references_per_symbol | 0 | 0 | 0 | 0 | 0 | 0 | none |
| commits_per_file | 128 | 1 | 1 | 4 | 16 | 16 | ≤1: 128 · ≤2: 16 · ≤4: 16 · ≤8: 8 · ≤16: 2 |
| authors_per_file | 128 | 1 | 1 | 2 | 8 | 8 | ≤1: 128 · ≤2: 32 · ≤4: 8 · ≤8: 2 |
| age_days | 128 | 256 | 256 | 256 | 256 | 256 | ≤256: 128 |
| cycle_size | 1 | 8 | 8 | 8 | 8 | 8 | ≤8: 1 |

## cost

- totalMs: 93
- samplingMs: 100

### phases

| phase | status | ms | filesPerSecond | bytesPerSecond |
| --- | --- | --- | --- | --- |
| walk | ok | 12 | 16384 | 536870912 |
| detect | ok | 17 | 8192 | 268435456 |
| typescript | ok | 0 | 0 | 0 |
| files | ok | 27 | 8192 | 268435456 |
| imports | ok | 5 | 32768 | 1073741824 |
| graph | ok | 1 | 131072 | 8589934592 |
| git | ok | 35 | 4096 | 134217728 |
| stats | ok | 0 | 0 | 0 |
| layout | ok | 15 | 16384 | 536870912 |
| findings | ok | 1 | 131072 | 8589934592 |

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
| typescript | done | 67108864 | 8388608 |
| files | done | 134217728 | 8388608 |
| imports | start | 134217728 | 8388608 |
| imports | done | 134217728 | 8388608 |
| graph | start | 134217728 | 8388608 |
| graph | done | 134217728 | 8388608 |
| layout | start | 134217728 | 8388608 |
| git | done | 134217728 | 8388608 |
| stats | start | 134217728 | 8388608 |
| stats | done | 134217728 | 8388608 |
| layout | done | 134217728 | 8388608 |
| findings | start | 134217728 | 8388608 |
| findings | done | 134217728 | 8388608 |

### totals

| code | value |
| --- | --- |
| peak_rss | 134217728 |
| peak_heap | 16777216 |
| high_water_rss | 134217728 |

### workers

| code | value |
| --- | --- |
| size | 2 |
| submitted | 32 |
| completed | 32 |
| failed | 0 |
| spawned | 2 |
| queuePeak | 8 |
| busyPeak | 2 |
| waitMs | 256 |
| runMs | 128 |

### payloads

| code | value |
| --- | --- |
| report | 131072 |
| source_chunk | 1048576 |
| assets | 2097152 |

### layout

| ms | budgetMs | siblingBudgetMs | exceeded |
| --- | --- | --- | --- |
| 0.71 | 150 | 0 | false |

## quality

- errors: none
- entryPoints: none
- validation: none

### imports

| language | internal | external | unresolved | unresolvedShare | shapes |
| --- | --- | --- | --- | --- | --- |
| python | 128 | 256 | 0 | 0 | none |

### rates

| code | value |
| --- | --- |
| ts_coverage | 0 |
| ts_unresolved_share | 0 |
| unused_export_share | 0 |

### typescript

| code | value |
| --- | --- |
| present | 0 |
| eligible | 0 |
| covered | 0 |
| projects | 0 |
| references | 0 |
| symbols | 0 |
| unresolved | 0 |
| uninstalledManifests | 0 |
| hostFiles | 0 |

### unusedExports

| code | value |
| --- | --- |
| exports | 0 |
| unusedExports | 0 |

### cycles

| code | value |
| --- | --- |
| runtime_cycles | 1 |
| type_cycles | 0 |

### diagnostics

| code | value |
| --- | --- |
| warnings_total | 2 |
| git_shallow | 1 |
| history_boundary | 1 |

## limits

| code | value |
| --- | --- |
| rust_use_cap | 0 |
| rust_statement_cap | 0 |
| pagerank_iteration_cap | 0 |
| module_split_cap | 0 |
| git_coupling_cap | 0 |
| git_sweep_threshold | 32 |
| git_sweep_commits | 1 |
| asset_size_cap | 0 |
| source_secret_disabled | 4 |
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
| shallow | 1 |
| truncated | 1 |
| analyzedCommits | 64 |
| totalCommits | 64 |
| source_file_cap | 1 |
| source_total_cap | 0 |
| source_disabled | 0 |

## queries

| tool | rank | status | ms | responseBytes | tokens | truncated | error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| overview | cold | ok | 0.22 | 4096 | 1024 | 0 | none |
| map_codebase | cold | ok | 0.71 | 4096 | 1024 | 0 | none |
| locate_code | top_hotspot | ok | 0.7 | 1024 | 256 | 0 | none |
| change_impact | top_hotspot | ok | 0.68 | 4096 | 1024 | 0 | none |
| change_impact | most_referenced | skipped | 0 | 0 | 0 | 0 | none |
| files | top_hotspot | ok | 0.25 | 16384 | 4096 | 128 | none |
| dir | largest_directory | ok | 0.22 | 8192 | 2048 | 0 | none |
| dir | median_directory | ok | 0.045 | 2048 | 512 | 0 | none |
| file | top_hotspot | ok | 0.17 | 4096 | 1024 | 0 | none |
| file | median_file | ok | 0.021 | 1024 | 256 | 0 | none |
| symbol | most_referenced | skipped | 0 | 0 | 0 | 0 | none |
| search_symbols | most_referenced | skipped | 0 | 0 | 0 | 0 | none |
| seams | cold | ok | 0.4 | 4096 | 1024 | 0 | none |
| seam | largest_directory | ok | 0.32 | 1024 | 256 | 0 | none |
| seam | median_directory | ok | 0.051 | 1024 | 256 | 0 | none |
| graph | top_hotspot | ok | 0.12 | 1024 | 256 | 0 | none |
| history | cold | ok | 0.13 | 1024 | 256 | 0 | none |
| dependencies | cold | ok | 0.11 | 4096 | 1024 | 32 | none |
| overview | warm | ok | 0.057 | 4096 | 1024 | 0 | none |

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
| 0 | 5 |
| 1 | 2 |
| 2 | 18 |
| 3 | 18 |
| 4 | 12 |
| 5 | 1 |
| 6 | 18 |
| 7 | 1 |
| 8 | 1 |
| 9 | 18 |
| 10 | 6 |
| 11 | 9 |
| 12 | 18 |
| 13 | 9 |
| 14 | 12 |
| 15 | 9 |
| 16 | 9 |
| 17 | 9 |
| 18 | -1 |
| 19 | 9 |
| 20 | 2 |
| 21 | 8 |
| 22 | 8 |
| 23 | 7 |

### files

| id | dir | language | category | bytes | lines | binary | secret | generated | vendored |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 18 | toml | config | 4096 | 128 | false | false | false | false |
| 1 | 10 | python | code | 2048 | 64 | false | false | false | false |
| 2 | 2 | python | test | 4096 | 128 | false | false | false | false |
| 3 | 0 | text | test | 4096 | 64 | false | false | false | false |
| 4 | 0 | makefile | test | 512 | 16 | false | false | false | false |
| 5 | 4 | markdown | config | 256 | 16 | false | false | false | false |
| 6 | 10 | python | code | 8192 | 128 | false | false | false | false |
| 7 | 18 | git-revision-list | config | 256 | 8 | false | false | false | false |
| 8 | 8 | markdown | docs | 256 | 16 | false | false | false | false |
| 9 | 12 | markdown | docs | 4096 | 128 | false | false | false | false |
| 10 | 3 | binary | docs | 4194304 | 0 | true | false | false | false |
| 11 | 20 | python | test | 8192 | 256 | false | false | false | false |
| 12 | 23 | ini | test | 1024 | 32 | false | false | false | false |
| 13 | 2 | python | test | 512 | 16 | false | false | false | false |
| 14 | 21 | text | test | 2048 | 32 | false | false | false | false |
| 15 | 10 | python | code | 8192 | 256 | false | false | false | false |
| 16 | 2 | python | test | 8192 | 256 | false | false | false | false |
| 17 | 9 | python | code | 16384 | 512 | false | false | false | false |
| 18 | 9 | pip-requirements | config | 128 | 4 | false | false | false | false |
| 19 | 21 | text | test | 4096 | 64 | false | false | false | false |
| 20 | 10 | python | code | 16384 | 512 | false | false | false | false |
| 21 | 15 | restructuredtext | docs | 8192 | 256 | false | false | false | false |
| 22 | 10 | python | code | 4096 | 256 | false | false | false | false |
| 23 | 14 | yaml | build | 1024 | 32 | false | false | false | false |
| 24 | 10 | python | code | 65536 | 2048 | false | false | false | false |
| 25 | 18 | pip-requirements | config | 128 | 8 | false | false | false | false |
| 26 | 10 | python | code | 8192 | 256 | false | false | false | false |
| 27 | 18 | ignore-list | config | 512 | 64 | false | false | false | false |
| 28 | 20 | python | test | 0 | 0 | false | false | false | false |
| 29 | 23 | makefile | test | 512 | 16 | false | false | false | false |
| 30 | 10 | python | code | 32768 | 1024 | false | false | false | false |
| 31 | 19 | restructuredtext | docs | 4096 | 64 | false | false | false | false |
| 32 | 15 | restructuredtext | docs | 2048 | 64 | false | false | false | false |
| 33 | 22 | makefile | test | 512 | 16 | false | false | false | false |
| 34 | 8 | makefile | test | 256 | 16 | false | false | false | false |
| 35 | 21 | ini | test | 512 | 32 | false | false | false | false |
| 36 | 14 | yaml | build | 2048 | 64 | false | false | false | false |
| 37 | 18 | text | config | 128 | 4 | false | false | false | false |
| 38 | 19 | restructuredtext | docs | 1024 | 16 | false | false | false | false |
| 39 | 22 | text | test | 2048 | 32 | false | false | false | false |
| 40 | 19 | restructuredtext | docs | 1024 | 32 | false | false | false | false |
| 41 | 10 | python | code | 65536 | 1024 | false | false | false | false |
| 42 | 9 | makefile | build | 8192 | 256 | false | false | false | false |
| 43 | 1 | markdown | docs | 512 | 16 | false | false | false | false |
| 44 | 23 | text | test | 4096 | 64 | false | false | false | false |
| 45 | 14 | yaml | build | 1024 | 32 | false | false | false | false |
| 46 | 10 | python | code | 512 | 16 | false | false | false | false |
| 47 | 7 | makefile | test | 128 | 8 | false | false | false | false |
| 48 | 2 | python | test | 131072 | 4096 | false | false | false | false |
| 49 | 18 | markdown | docs | 65536 | 4096 | false | false | false | false |
| 50 | 10 | python | code | 65536 | 2048 | false | false | false | false |
| 51 | 18 | restructuredtext | docs | 8192 | 256 | false | false | false | false |
| 52 | 2 | python | test | 32768 | 1024 | false | false | false | false |
| 53 | 10 | python | code | 1024 | 32 | false | false | false | false |
| 54 | 23 | text | test | 2048 | 32 | false | false | false | false |
| 55 | 2 | python | test | 512 | 8 | false | false | false | false |
| 56 | 0 | ini | test | 1024 | 32 | false | false | false | false |
| 57 | 19 | restructuredtext | docs | 4096 | 64 | false | false | false | false |
| 58 | 2 | python | test | 512 | 32 | false | false | false | false |
| 59 | 9 | restructuredtext | docs | 8192 | 512 | false | false | false | false |
| 60 | 3 | svg | image | 1048576 | 1 | false | false | false | false |
| 61 | 12 | markdown | config | 8192 | 128 | false | false | false | false |
| 62 | 21 | text | test | 2048 | 32 | false | true | false | false |
| 63 | 3 | text | docs | 64 | 1 | false | false | false | false |
| 64 | 14 | yaml | build | 4096 | 128 | false | false | false | false |
| 65 | 4 | markdown | config | 1024 | 64 | false | false | false | false |
| 66 | 15 | restructuredtext | docs | 32768 | 1024 | false | false | false | false |
| 67 | 17 | html | docs | 2048 | 64 | false | false | false | true |
| 68 | 22 | ini | test | 512 | 32 | false | false | false | false |
| 69 | 19 | restructuredtext | docs | 256 | 8 | false | false | false | false |
| 70 | 9 | batchfile | code | 8192 | 512 | false | false | false | false |
| 71 | 22 | text | test | 64 | 1 | false | false | false | false |
| 72 | 15 | restructuredtext | docs | 65536 | 2048 | false | false | false | false |
| 73 | 18 | yaml | config | 1024 | 32 | false | false | false | false |
| 74 | 0 | text | test | 2048 | 32 | false | true | false | false |
| 75 | 13 | text | docs | 2048 | 64 | false | false | false | true |
| 76 | 2 | python | test | 2048 | 128 | false | false | false | false |
| 77 | 19 | restructuredtext | docs | 512 | 32 | false | false | false | false |
| 78 | 18 | makefile | build | 1024 | 32 | false | false | false | false |
| 79 | 3 | binary | image | 262144 | 0 | true | false | false | false |
| 80 | 3 | binary | image | 16384 | 0 | true | false | false | false |
| 81 | 2 | python | test | 512 | 32 | false | false | false | false |
| 82 | 2 | python | test | 512 | 32 | false | false | false | false |
| 83 | 10 | python | code | 8192 | 256 | false | false | false | false |
| 84 | 12 | markdown | docs | 512 | 8 | false | false | false | false |
| 85 | 13 | python | code | 8192 | 128 | false | false | false | true |
| 86 | 18 | markdown | docs | 4096 | 128 | false | false | false | false |
| 87 | 10 | python | code | 512 | 32 | false | false | false | false |
| 88 | 4 | markdown | config | 256 | 16 | false | false | false | false |
| 89 | 18 | yaml | config | 512 | 32 | false | false | false | false |
| 90 | 14 | yaml | test | 4096 | 128 | false | false | false | false |
| 91 | 12 | markdown | docs | 4096 | 128 | false | false | false | false |
| 92 | 14 | yaml | build | 1024 | 32 | false | false | false | false |
| 93 | 14 | yaml | build | 4096 | 128 | false | false | false | false |
| 94 | 12 | codeowners | config | 512 | 8 | false | false | false | false |
| 95 | 10 | python | code | 8192 | 256 | false | false | false | false |
| 96 | 0 | text | test | 2048 | 32 | false | false | false | false |
| 97 | 9 | restructuredtext | docs | 4096 | 256 | false | false | false | false |
| 98 | 13 | ignore-list | config | 32 | 4 | false | false | false | true |
| 99 | 2 | python | test | 16384 | 512 | false | false | false | false |
| 100 | 18 | text | docs | 16384 | 256 | false | false | false | false |
| 101 | 10 | python | code | 8192 | 256 | false | false | false | false |
| 102 | 23 | text | test | 2048 | 32 | false | true | false | false |
| 103 | 2 | python | test | 1024 | 32 | false | false | false | false |
| 104 | 7 | markdown | docs | 256 | 4 | false | false | false | false |
| 105 | 12 | yaml | config | 1024 | 32 | false | false | false | false |
| 106 | 9 | text | config | 1 | 1 | false | false | false | false |
| 107 | 10 | text | config | 0 | 0 | false | false | false | false |
| 108 | 22 | text | test | 2048 | 32 | false | true | false | false |
| 109 | 11 | restructuredtext | docs | 8192 | 256 | false | false | false | false |
| 110 | 2 | python | test | 256 | 16 | false | false | false | false |
| 111 | 12 | yaml | config | 64 | 1 | false | false | false | false |
| 112 | 12 | markdown | config | 512 | 32 | false | false | false | false |
| 113 | 18 | text | docs | 64 | 2 | false | false | false | false |
| 114 | 16 | binary | image | 524288 | 0 | true | false | false | true |
| 115 | 18 | ini | config | 64 | 2 | false | false | false | false |
| 116 | 11 | restructuredtext | docs | 64 | 4 | false | false | false | false |
| 117 | 14 | yaml | build | 512 | 32 | false | false | false | false |
| 118 | 18 | ini | config | 512 | 32 | false | false | false | false |
| 119 | 10 | python | code | 2048 | 64 | false | false | false | false |
| 120 | 19 | restructuredtext | docs | 4096 | 128 | false | false | false | false |
| 121 | 18 | python | build | 256 | 16 | false | false | false | false |
| 122 | 3 | binary | image | 262144 | 0 | true | false | false | false |
| 123 | 16 | css | style | 512 | 16 | false | false | false | true |
| 124 | 21 | makefile | test | 512 | 16 | false | false | false | false |
| 125 | 10 | python | code | 32768 | 1024 | false | false | false | false |
| 126 | 10 | python | code | 4096 | 128 | false | false | false | false |
| 127 | 3 | binary | image | 16384 | 0 | true | false | false | false |

### edges

| id | from | to | kind | type |
| --- | --- | --- | --- | --- |
| 0 | 1 | 126 | import | false |
| 1 | 2 | 15 | import | false |
| 2 | 6 | 15 | import | false |
| 3 | 15 | 126 | import | false |
| 4 | 16 | 11 | import | false |
| 5 | 16 | 101 | import | false |
| 6 | 17 | 101 | import | false |
| 7 | 20 | 1 | import | false |
| 8 | 20 | 24 | import | false |
| 9 | 20 | 30 | import | false |
| 10 | 20 | 50 | import | false |
| 11 | 20 | 126 | import | false |
| 12 | 22 | 46 | import | false |
| 13 | 24 | 1 | import | false |
| 14 | 24 | 15 | import | false |
| 15 | 24 | 30 | import | false |
| 16 | 24 | 46 | import | false |
| 17 | 24 | 50 | import | false |
| 18 | 24 | 83 | import | false |
| 19 | 24 | 87 | import | false |
| 20 | 24 | 95 | import | false |
| 21 | 24 | 126 | import | false |
| 22 | 26 | 41 | import | false |
| 23 | 26 | 50 | import | false |
| 24 | 26 | 83 | import | false |
| 25 | 30 | 1 | import | false |
| 26 | 30 | 50 | import | false |
| 27 | 30 | 83 | import | false |
| 28 | 30 | 126 | import | false |
| 29 | 41 | 1 | import | false |
| 30 | 41 | 6 | import | false |
| 31 | 41 | 15 | import | false |
| 32 | 41 | 20 | import | false |
| 33 | 41 | 24 | import | false |
| 34 | 41 | 30 | import | false |
| 35 | 41 | 50 | import | false |
| 36 | 41 | 83 | import | false |
| 37 | 41 | 95 | import | false |
| 38 | 41 | 119 | import | false |
| 39 | 41 | 125 | import | false |
| 40 | 41 | 126 | import | false |
| 41 | 48 | 11 | import | false |
| 42 | 48 | 13 | import | false |
| 43 | 48 | 15 | import | false |
| 44 | 48 | 20 | import | false |
| 45 | 48 | 30 | import | false |
| 46 | 48 | 41 | import | false |
| 47 | 48 | 50 | import | false |
| 48 | 48 | 53 | import | false |
| 49 | 48 | 58 | import | false |
| 50 | 48 | 81 | import | false |
| 51 | 48 | 95 | import | false |
| 52 | 48 | 101 | import | false |
| 53 | 48 | 119 | import | false |
| 54 | 48 | 125 | import | false |
| 55 | 48 | 126 | import | false |
| 56 | 50 | 1 | import | false |
| 57 | 50 | 6 | import | false |
| 58 | 50 | 15 | import | false |
| 59 | 50 | 20 | import | false |
| 60 | 50 | 24 | import | false |
| 61 | 50 | 30 | import | false |
| 62 | 50 | 83 | import | false |
| 63 | 50 | 95 | import | false |
| 64 | 50 | 119 | import | false |
| 65 | 50 | 125 | import | false |
| 66 | 50 | 126 | import | false |
| 67 | 52 | 1 | import | false |
| 68 | 52 | 15 | import | false |
| 69 | 52 | 24 | import | false |
| 70 | 52 | 30 | import | false |
| 71 | 52 | 81 | import | false |
| 72 | 52 | 101 | import | false |
| 73 | 53 | 126 | import | false |
| 74 | 55 | 125 | import | false |
| 75 | 76 | 126 | import | false |
| 76 | 82 | 101 | import | false |
| 77 | 83 | 15 | import | false |
| 78 | 83 | 20 | import | false |
| 79 | 83 | 30 | import | false |
| 80 | 83 | 50 | import | false |
| 81 | 95 | 50 | import | false |
| 82 | 95 | 126 | import | false |
| 83 | 99 | 11 | import | false |
| 84 | 99 | 58 | import | false |
| 85 | 99 | 101 | import | false |
| 86 | 99 | 126 | import | false |
| 87 | 101 | 6 | import | false |
| 88 | 101 | 24 | import | false |
| 89 | 101 | 26 | import | false |
| 90 | 101 | 41 | import | false |
| 91 | 101 | 46 | import | false |
| 92 | 101 | 50 | import | false |
| 93 | 101 | 53 | import | false |
| 94 | 101 | 95 | import | false |
| 95 | 103 | 22 | import | false |
| 96 | 110 | 101 | import | false |
| 97 | 119 | 50 | import | false |
| 98 | 119 | 83 | import | false |
| 99 | 125 | 15 | import | false |
| 100 | 125 | 20 | import | false |
| 101 | 125 | 24 | import | false |
| 102 | 125 | 30 | import | false |
| 103 | 125 | 50 | import | false |
| 104 | 125 | 83 | import | false |
| 105 | 125 | 95 | import | false |
| 106 | 125 | 126 | import | false |
