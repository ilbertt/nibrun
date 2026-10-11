import json
import boto3
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time
import urllib.request

OUTPUT = Path('/output')
BINARY = '/tools/zerofs'
TOTAL_MIB = int(os.environ.get('REPRO_TOTAL_MIB', '1024'))
CYCLES = int(os.environ.get('REPRO_CYCLES', '4'))
IDLE_SECONDS = int(os.environ.get('REPRO_IDLE_SECONDS', '60'))
FILES = 16
CHUNK_BYTES = 256 * 1024
if not 16 <= TOTAL_MIB <= 4096 or not 1 <= CYCLES <= 20 or not 1 <= IDLE_SECONDS <= 600:
    raise ValueError('workload must be 16..4096 MiB, 1..20 cycles, 1..600 seconds idle')

stop_sampling = threading.Event()
phase = 'startup'
server = None
mount = None
object_store = None


def metric_values():
    text = urllib.request.urlopen('http://127.0.0.1:9091/metrics', timeout=2).read().decode()
    values = {}
    for line in text.splitlines():
        if line.startswith(('zerofs_jemalloc_', 'zerofs_segment_gc_', 'zerofs_dedup_', 'lsm_db_total_mem_size_bytes', 'zerofs_bytes_')):
            name, value = line.split()
            values[name] = float(value)
    return values


def sample():
    record = {'at': time.time(), 'phase': phase, 'pid': server.pid}
    try:
        for line in Path(f'/proc/{server.pid}/status').read_text().splitlines():
            if line.startswith(('VmRSS:', 'RssAnon:')):
                name, value, unit = line.split()
                record[name.rstrip(':') + 'Bytes'] = int(value) * 1024
        record.update(metric_values())
    except (OSError, ValueError) as error:
        record['sampleError'] = str(error)
    with (OUTPUT / 'memory.jsonl').open('a') as output:
        output.write(json.dumps(record) + '\n')
    return record


def sampling_loop():
    while not stop_sampling.wait(5):
        sample()


def enter_phase(name):
    global phase
    phase = name
    print(json.dumps({'phase': phase, 'at': time.time()}), flush=True)
    sample()


def write_files(paths):
    bytes_per_file = TOTAL_MIB * 1024 * 1024 // FILES
    for path in paths:
        with path.open('wb', buffering=0) as output:
            remaining = bytes_per_file
            while remaining:
                chunk = os.urandom(min(CHUNK_BYTES, remaining))
                output.write(chunk)
                remaining -= len(chunk)


def read_files(paths):
    for path in paths:
        with path.open('rb', buffering=0) as source:
            while source.read(CHUNK_BYTES):
                pass


def wait_ready():
    for attempt in range(120):
        if server.poll() is not None:
            raise RuntimeError(f'ZeroFS exited during startup: {server.returncode}')
        try:
            metric_values()
            return
        except OSError:
            time.sleep(0.5)
    raise TimeoutError('ZeroFS metrics did not become ready')


def stop_process(process):
    if process is None or process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=120)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def reproduce():
    global server, mount, object_store
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='zerofs-memory-') as directory:
        root = Path(directory)
        objects = root / 'objects'
        cache = root / 'cache'
        mounted = root / 'mounted'
        for path in [objects, cache, mounted]:
            path.mkdir()
        config = root / 'zerofs.toml'
        config.write_text(f'''[cache]
dir = "{cache}"
disk_size_gb = 8.0
memory_size_gb = 2.0
warm_metadata = "filters_index"
[storage]
url = "s3://reproduction/isolated"
encryption_password = "local-reproduction-only"
[aws]
endpoint = "http://127.0.0.1:9000"
allow_http = "true"
access_key_id = "local-reproduction"
secret_access_key = "local-reproduction-only"
region = "us-east-1"
[filesystem]
ignore_fsync = true
compression = "zstd-3"
[lsm]
flush_interval_secs = 5
[servers.ninep]
unix_socket = "{root}/9p.sock"
[servers.rpc]
unix_socket = "{root}/rpc.sock"
[prometheus]
addresses = ["127.0.0.1:9091"]
[telemetry]
enabled = false
''')
        metadata = {'totalMib': TOTAL_MIB, 'cycles': CYCLES, 'idleSeconds': IDLE_SECONDS,
                    'machine': os.uname().machine, 'backend': 'isolated-local-minio',
                    'version': subprocess.check_output([BINARY, '--version'], text=True).strip()}
        (OUTPUT / 'run.json').write_text(json.dumps(metadata, indent=2) + '\n')
        with (OUTPUT / 'zerofs.log').open('w') as server_log, (OUTPUT / 'mount.log').open('w') as mount_log, (OUTPUT / 'minio.log').open('w') as minio_log:
            try:
                env = {**os.environ, 'MINIO_ROOT_USER': 'local-reproduction', 'MINIO_ROOT_PASSWORD': 'local-reproduction-only'}
                object_store = subprocess.Popen(['/tools/minio', 'server', str(objects), '--address', '127.0.0.1:9000', '--console-address', '127.0.0.1:9001'], env=env, stdout=minio_log, stderr=subprocess.STDOUT)
                s3 = boto3.client('s3', endpoint_url='http://127.0.0.1:9000', region_name='us-east-1', aws_access_key_id='local-reproduction', aws_secret_access_key='local-reproduction-only')
                for attempt in range(120):
                    try:
                        urllib.request.urlopen('http://127.0.0.1:9000/minio/health/live', timeout=1)
                        break
                    except OSError:
                        if object_store.poll() is not None:
                            raise RuntimeError('MinIO exited during startup')
                        time.sleep(0.5)
                else:
                    raise TimeoutError('MinIO did not become ready')
                s3.create_bucket(Bucket='reproduction')
                server = subprocess.Popen([BINARY, 'run', '--config', str(config)], stdout=server_log, stderr=subprocess.STDOUT)
                wait_ready()
                mount = subprocess.Popen([BINARY, 'mount', '--writeback', 'false', '--relaxed-consistency', 'false',
                                          f'unix:{root}/9p.sock', str(mounted)], stdout=mount_log, stderr=subprocess.STDOUT)
                for attempt in range(120):
                    if os.path.ismount(mounted):
                        break
                    if mount.poll() is not None:
                        raise RuntimeError('FUSE mount failed; inspect mount.log')
                    time.sleep(0.5)
                else:
                    raise TimeoutError('FUSE mount did not become ready')
                threading.Thread(target=sampling_loop, daemon=True).start()
                paths = [mounted / f'file-{i:02d}' for i in range(FILES)]
                enter_phase('baseline')
                for cycle in range(CYCLES):
                    enter_phase(f'{cycle}:write')
                    write_files(paths)
                    enter_phase(f'{cycle}:read')
                    read_files(paths)
                    enter_phase(f'{cycle}:overwrite')
                    write_files(paths[::2])
                    enter_phase(f'{cycle}:delete-refill')
                    for path in paths[1::2]:
                        path.unlink()
                    write_files(paths[1::2])
                    subprocess.run([BINARY, 'flush', '--config', str(config)], check=True, stdout=server_log, stderr=subprocess.STDOUT)
                    enter_phase(f'{cycle}:idle')
                    time.sleep(IDLE_SECONDS)
                    sample()
                enter_phase('finished')
            finally:
                stop_sampling.set()
                stop_process(mount)
                stop_process(server)
                stop_process(object_store)


if __name__ == '__main__':
    reproduce()
