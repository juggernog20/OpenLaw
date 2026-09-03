# SPDX-License-Identifier: AGPL-3.0-only

"""Run one LibreOffice Writer comparison through a private UNO pipe."""

import ctypes
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.connection import NoConnectException


class UnreadableSource(Exception):
    """One compare operand is not a document Writer can open."""


def property_value(name, value):
    prop = PropertyValue()
    prop.Name = name
    prop.Value = value
    return prop


def child_dies_with_parent():
    # Linux PR_SET_PDEATHSIG. The Node wrapper kills this Python process
    # when the operation bound expires; LibreOffice must not survive it.
    ctypes.CDLL(None).prctl(1, signal.SIGKILL)


def connect(pipe_name):
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    address = f"uno:pipe,name={pipe_name};urp;StarOffice.ComponentContext"
    deadline = time.monotonic() + 30
    while True:
        try:
            return resolver.resolve(address)
        except NoConnectException:
            if time.monotonic() >= deadline:
                raise RuntimeError("LibreOffice did not open its UNO pipe in time")
            time.sleep(0.05)


def open_document(desktop, path, label, read_only):
    try:
        document = desktop.loadComponentFromURL(
            path.resolve().as_uri(),
            "_blank",
            0,
            (
                property_value("Hidden", False),
                property_value("ReadOnly", read_only),
                property_value("ShowTrackedChanges", True),
            ),
        )
    except Exception as error:
        raise UnreadableSource(
            f"LibreOffice could not open the {label} Word file"
        ) from error
    if document is None:
        raise UnreadableSource(f"LibreOffice could not open the {label} Word file")
    return document


def main():
    if len(sys.argv) != 5:
        raise RuntimeError("compare.py needs OLD NEW OUTPUT PROFILE")

    older, newer, output, profile = map(Path, sys.argv[1:])
    pipe_name = f"openlaw-{uuid.uuid4().hex}"
    accept = f"--accept=pipe,name={pipe_name};urp;StarOffice.ComponentContext"
    office = subprocess.Popen(
        [
            "soffice",
            f"-env:UserInstallation={profile.resolve().as_uri()}",
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--nodefault",
            "--nofirststartwizard",
            accept,
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        # Node starts Python as a process-group leader. Writer inherits
        # that group, so a bound or a disconnected caller kills the
        # whole Python → soffice → soffice.bin tree in one signal.
        preexec_fn=child_dies_with_parent,
    )
    document = None
    try:
        context = connect(pipe_name)
        services = context.ServiceManager
        desktop = services.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        older_document = open_document(desktop, older, "older", True)
        older_document.close(True)
        document = open_document(desktop, newer, "newer", False)

        frame = document.getCurrentController().getFrame()
        dispatcher = services.createInstanceWithContext(
            "com.sun.star.frame.DispatchHelper", context
        )
        dispatcher.executeDispatch(
            frame,
            ".uno:CompareDocuments",
            "",
            0,
            (property_value("URL", older.resolve().as_uri()),),
        )
        document.storeAsURL(
            output.resolve().as_uri(),
            (
                property_value("FilterName", "Office Open XML Text"),
                property_value("Overwrite", True),
            ),
        )
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError("LibreOffice produced no tracked-changes Word file")
    finally:
        if document is not None:
            try:
                document.close(True)
            except Exception:
                pass
        office.terminate()
        try:
            office.wait(timeout=5)
        except subprocess.TimeoutExpired:
            office.kill()
            office.wait()


if __name__ == "__main__":
    try:
        main()
    except UnreadableSource as error:
        print(f"LibreOffice compare refused a source: {error}", file=sys.stderr)
        sys.exit(2)
    except Exception as error:
        print(f"LibreOffice compare failed: {error}", file=sys.stderr)
        sys.exit(1)
