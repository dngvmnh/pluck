"""The default session secret must fail closed in production (else session forgery)."""
import os
import subprocess
import sys


def test_production_without_secret_fails_closed():
    env = {**os.environ, "PYTHONPATH": ".", "MYTHOS_ENV": "production"}
    env.pop("SESSION_SECRET", None)
    r = subprocess.run([sys.executable, "-c", "import pluck.config"],
                       capture_output=True, text=True, env=env)
    assert r.returncode != 0
    assert "SESSION_SECRET" in r.stderr


def test_production_with_secret_ok():
    env = {**os.environ, "PYTHONPATH": ".", "MYTHOS_ENV": "production", "SESSION_SECRET": "x" * 64}
    r = subprocess.run([sys.executable, "-c", "import pluck.config"],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr


def test_dev_default_secret_ok():
    env = {**os.environ, "PYTHONPATH": "."}
    env.pop("SESSION_SECRET", None)
    env.pop("MYTHOS_ENV", None)
    r = subprocess.run([sys.executable, "-c", "import pluck.config"],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
