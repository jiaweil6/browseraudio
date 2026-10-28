"""Audio I/O for in-browser Python: record, play, and synthesize in real time."""

from ._keyboard import Keyboard, KeyMap, keyboard
from ._player import Player, play
from ._recorder import Recorder, record
from ._stream import Block, Stream, stream

__all__ = [
    "Recorder", "record", "Player", "play", "Keyboard", "KeyMap", "keyboard",
    "Stream", "Block", "stream",
]
__version__ = "0.3.0"
