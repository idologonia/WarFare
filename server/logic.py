"""Серверна логіка WarFare для HOME GAME SERVER (HGS).

Сервер — головний: клієнти надсилають лише дії гравця (`wf_action`), сервер перевіряє їх тими самими
правилами бою, що й гра (server/sim-node.cjs — зібраний TypeScript-код симуляції, запускається через Node.js),
і розсилає прийняті дії (`wf_applied`) або повний стан для синхронізації (`wf_state`).

Події сервера → клієнт:
  wf_you     {side, scenarioId}                  — ваша сторона в кімнаті
  wf_start   {scenarioId, seed, difficulty, sides} — обидва гравці на місці, бій почався
  wf_applied {seq, side, cmd}                    — прийнята дія суперника
  wf_ack     {seq}                               — вашу дію прийнято
  wf_state   {state, seq, error?}                — повний стан (відмова, перепідключення)
  wf_peer    {connected, name}                   — суперник від'єднався / повернувся
Події клієнт → сервер: wf_action {cmd}, wf_sync {}.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import shutil
from pathlib import Path

from hgs_sdk import GameLogic

HERE = Path(__file__).resolve().parent
SIDES = ("blue", "red")
DIFFICULTIES = ("easy", "medium", "hard")


def find_node() -> str | None:
    """Node.js: системний або портативний з папки гри (tools/node-*/node.exe від start-server.bat)."""
    found = shutil.which("node")
    if found:
        return found
    tools = HERE.parent / "tools"
    if tools.is_dir():
        for p in sorted(tools.glob("node-*/node*")):
            if p.name in ("node", "node.exe") and p.is_file():
                return str(p)
    return None


class Sim:
    """Процес Node.js з правилами бою; запити — JSON-рядки, відповіді — за id."""

    def __init__(self, log) -> None:
        self.log = log
        self.proc: asyncio.subprocess.Process | None = None
        self.next_id = 0
        self.waiting: dict[int, asyncio.Future] = {}
        self.lock = asyncio.Lock()
        self.reader_task: asyncio.Task | None = None

    async def ensure(self) -> None:
        if self.proc and self.proc.returncode is None:
            return
        node = find_node()
        if not node:
            raise RuntimeError("Не знайдено Node.js на сервері — встановіть його з nodejs.org")
        self.proc = await asyncio.create_subprocess_exec(
            node, str(HERE / "sim-node.cjs"),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            limit=64 * 1024 * 1024, cwd=str(HERE),
        )
        self.reader_task = asyncio.create_task(self._read())
        asyncio.create_task(self._errors())
        self.log.info("WarFare rules process started (pid %s)", self.proc.pid)

    async def _read(self) -> None:
        assert self.proc and self.proc.stdout
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            fut = self.waiting.pop(msg.get("id"), None)
            if fut and not fut.done():
                fut.set_result(msg)
        for fut in self.waiting.values():
            if not fut.done():
                fut.set_result({"ok": False, "error": "Процес правил зупинився"})
        self.waiting.clear()

    async def _errors(self) -> None:
        assert self.proc and self.proc.stderr
        while True:
            line = await self.proc.stderr.readline()
            if not line:
                break
            self.log.warning("rules: %s", line.decode("utf-8", "replace").rstrip())

    async def call(self, op: str, room: str, **data) -> dict:
        async with self.lock:
            await self.ensure()
            self.next_id += 1
            rid = self.next_id
            fut = asyncio.get_running_loop().create_future()
            self.waiting[rid] = fut
            assert self.proc and self.proc.stdin
            self.proc.stdin.write((json.dumps({"id": rid, "op": op, "room": room, **data}, ensure_ascii=False) + "\n").encode("utf-8"))
            await self.proc.stdin.drain()
        try:
            return await asyncio.wait_for(fut, timeout=20)
        except asyncio.TimeoutError:
            self.waiting.pop(rid, None)
            return {"ok": False, "error": "Сервер правил не відповідає"}

    async def close(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.stdin.close()
                await asyncio.wait_for(self.proc.wait(), timeout=3)
            except Exception:
                self.proc.kill()


class Game(GameLogic):
    def __init__(self) -> None:
        super().__init__()
        self.sim = Sim(self.log)
        self.battles = 0

    async def on_shutdown(self) -> None:
        await self.sim.close()

    @staticmethod
    def _st(room) -> dict:
        if room.state is None:
            p = room.params or {}
            side = p.get("side") if p.get("side") in SIDES else "blue"
            diff = p.get("difficulty") if p.get("difficulty") in DIFFICULTIES else "medium"
            room.state = {"scenarioId": str(p.get("scenarioId") or "first_mission"), "hostSide": side,
                          "difficulty": diff, "players": {}, "names": {}, "seq": 0, "started": False, "seed": None}
        return room.state

    async def on_join(self, room, player):
        if room.id == "lobby":
            return None
        st = self._st(room)
        if player.id in st["players"]:  # повернення в кімнату
            side = st["players"][player.id]
            room.send(player, "wf_you", {"side": side, "scenarioId": st["scenarioId"]})
            if st["started"]:
                res = await self.sim.call("state", room.id)
                if res.get("ok"):
                    room.send(player, "wf_state", {"state": res["state"], "seq": st["seq"]})
            room.broadcast("wf_peer", {"connected": True, "name": player.name}, exclude=player)
            return None
        if len(st["players"]) >= 2:
            return "Кімната заповнена"
        side = st["hostSide"] if not st["players"] else ("red" if st["hostSide"] == "blue" else "blue")
        st["players"][player.id] = side
        st["names"][player.id] = player.name
        room.send(player, "wf_you", {"side": side, "scenarioId": st["scenarioId"]})
        if len(st["players"]) == 2 and not st["started"]:
            st["seed"] = random.randint(1, 2**31 - 1)
            res = await self.sim.call("create", room.id, scenarioId=st["scenarioId"], seed=st["seed"], difficulty=st["difficulty"])
            if not res.get("ok"):
                room.broadcast("wf_error", {"error": res.get("error", "Не вдалося створити бій")})
                return None
            st["started"] = True
            self.battles += 1
            self.set_status(battles=self.battles)
            room.update(status="locked")
            room.broadcast("wf_start", {"scenarioId": st["scenarioId"], "seed": st["seed"], "difficulty": st["difficulty"],
                                        "sides": st["players"], "names": st["names"]})
        return None

    async def on_event(self, room, player, event, data):
        if room.id == "lobby" or room.state is None:
            return
        st = room.state
        side = st["players"].get(player.id)
        if not side or not st["started"]:
            return
        if event == "wf_action" and isinstance(data, dict) and isinstance(data.get("cmd"), dict):
            res = await self.sim.call("act", room.id, side=side, cmd=data["cmd"])
            if res.get("ok"):
                st["seq"] += 1
                room.broadcast("wf_applied", {"seq": st["seq"], "side": side, "cmd": data["cmd"]}, exclude=player)
                room.send(player, "wf_ack", {"seq": st["seq"]})
                if res.get("ended"):
                    self.log.info("battle in room %s ended", room.id)
            else:
                full = await self.sim.call("state", room.id)
                room.send(player, "wf_state", {"state": full.get("state"), "seq": st["seq"], "error": res.get("error")})
        elif event == "wf_sync":
            full = await self.sim.call("state", room.id)
            if full.get("ok"):
                room.send(player, "wf_state", {"state": full["state"], "seq": st["seq"]})

    async def on_leave(self, room, player, reason):
        if room.id == "lobby" or room.state is None:
            return
        st = room.state
        if not st["started"]:
            st["players"].pop(player.id, None)  # до початку бою місце звільняється
            st["names"].pop(player.id, None)
            return
        room.broadcast("wf_peer", {"connected": False, "name": player.name}, exclude=player)

    async def on_room_closed(self, room):
        await self.sim.call("drop", room.id)
