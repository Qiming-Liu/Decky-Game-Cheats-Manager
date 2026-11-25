-- DeckyGCM bridge. Cheat Engine loads every autorun/*.lua at start; this one
-- lets the plugin's Quick Access panel read and switch the open table's
-- entries while a game runs.
--
-- The launcher starts Cheat Engine with GCM_TABLE set to the table's path.
-- Next to that table, in `.gcm-runtime/`:
--   commands.jsonl  one command per line, appended by the plugin:
--                   {"n":1,"id":1034,"active":true}  {"n":2,"id":1041,"value":"100"}
--                   {"n":3,"all":false}  {"n":4,"attach":"game.exe"}
--   state.json      the whole entry tree, the attached process and Cheat
--                   Engine's own process list, written here whenever
--                   something changed.
-- Commands carry a rising number; each is applied once.

local RUNTIME = ".gcm-runtime"
local INTERVAL = 300

local lastCommand = 0
local lastState = nil
local failed = {}
-- Why Cheat Engine refused an entry, in its own words: { reason, text } by
-- entry ID. reason is the name of its activation-failure code (afAOBNotFound,
-- afAssertFailure, ...) or "lua" for an error the switch itself raised; text
-- is Cheat Engine's description. Shown under the entry with failed[id].
local failureDetail = {}
local hooked = {}
local REASON_NAMES = nil
-- Async scripts finish in their own thread: whether one activated is known
-- only once it stops processing.
local activating = {}
local pendingAttach = nil
-- The newest error a table's own Lua raised: { text, ts } (see readScriptErrors).
local scriptError = nil
-- Cheat Engine could not inject a DLL into the game (its Mono/IL2CPP data
-- collector, for example): { text, ts }. It fails this way under FEX on ARM.
local injectionError = nil
local SCRIPT_TYPE = vtAutoAssembler or 11

-- A log next to this script; the plugin copies new lines into its own log.
-- The launcher names it by an ASCII short path (GCM_LOG): io.open takes ANSI
-- paths, and Cheat Engine's own folder name may hold any language. Starts
-- append to it, and past LOG_BYTES it moves to .old. Each line is written and
-- closed at once: when Cheat Engine freezes, the last line says what it was
-- doing. A line repeating within REPEAT_SECONDS is counted, not written again.
local LOG_BYTES = 512 * 1024
local REPEAT_SECONDS = 60
local lastLine, lastLineTime, repeats = nil, 0, 0

local function logPath()
  local target = os.getenv("GCM_LOG")
  if target and target ~= "" then return target end
  local ok, path = pcall(getAutorunPath)
  return ok and path and path .. "decky_gcm.log" or nil
end

local function writeLine(text)
  local target = logPath()
  local file = target and io.open(target, "a")
  if not file then return end
  local size = file:seek("end")
  if size and size > LOG_BYTES then
    file:close()
    os.remove(target .. ".old")
    os.rename(target, target .. ".old")
    file = io.open(target, "a")
    if not file then return end
  end
  file:write(os.date("%Y-%m-%d %H:%M:%S "), text, "\n")
  file:close()
end

local function log(text)
  local now = os.time()
  if text == lastLine and now - lastLineTime < REPEAT_SECONDS then
    repeats = repeats + 1
    return
  end
  if repeats > 0 then writeLine(string.format("(the line above repeated %d more times)", repeats)) end
  lastLine, lastLineTime, repeats = text, now, 0
  writeLine(text)
end

local function milliseconds(started)
  return math.floor((os.clock() - started) * 1000 + 0.5)
end

local function encodeString(text)
  text = tostring(text or "")
  return '"' .. text:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == "\\" then return "\\\\" end
    if c == "\n" then return "\\n" end
    if c == "\r" then return "\\r" end
    if c == "\t" then return "\\t" end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function encode(value)
  local kind = type(value)
  if kind == "table" then
    if value[1] ~= nil or next(value) == nil then
      local parts = {}
      for i = 1, #value do parts[i] = encode(value[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for key in pairs(value) do keys[#keys + 1] = key end
    table.sort(keys)
    local parts = {}
    for i, key in ipairs(keys) do parts[i] = encodeString(key) .. ":" .. encode(value[key]) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif kind == "string" then
    return encodeString(value)
  elseif kind == "number" then
    if value == math.floor(value) then return string.format("%d", value) end
    return string.format("%.14g", value)
  elseif kind == "boolean" then
    return value and "true" or "false"
  end
  return "null"
end

-- Reads one quoted JSON string starting at `position` (the opening quote).
local function readString(body, position)
  local parts = {}
  local i = position + 1
  while i <= #body do
    local c = body:sub(i, i)
    if c == '"' then return table.concat(parts), i + 1 end
    if c == "\\" then
      local e = body:sub(i + 1, i + 1)
      if e == "n" then parts[#parts + 1] = "\n"
      elseif e == "r" then parts[#parts + 1] = "\r"
      elseif e == "t" then parts[#parts + 1] = "\t"
      elseif e == "u" then
        local code = tonumber(body:sub(i + 2, i + 5), 16) or 63
        parts[#parts + 1] = utf8 and utf8.char(code) or string.char(code % 256)
        i = i + 4
      else parts[#parts + 1] = e end
      i = i + 2
    else
      parts[#parts + 1] = c
      i = i + 1
    end
  end
  return table.concat(parts), i
end

-- Reads one flat command object: string, number, boolean or null values only.
local function decode(line)
  local result = {}
  local body = line:match("^%s*{(.*)}%s*$")
  if not body then return nil end
  local position = 1
  while position <= #body do
    local keyStart = body:find('"', position, true)
    if not keyStart then break end
    local key, after = readString(body, keyStart)
    local colon = body:find(":", after, true)
    if not colon then break end
    position = colon + 1
    while body:sub(position, position):match("%s") do position = position + 1 end
    if body:sub(position, position) == '"' then
      result[key], position = readString(body, position)
    else
      local token = body:match("^[^,}]+", position) or ""
      position = position + #token
      token = token:gsub("%s+$", "")
      if token == "true" then result[key] = true
      elseif token == "false" then result[key] = false
      elseif token ~= "null" then result[key] = tonumber(token) end
    end
    local comma = body:find(",", position, true)
    if not comma then break end
    position = comma + 1
  end
  return result
end

local function tableFolder()
  local name = os.getenv("GCM_TABLE")
  if not name or name == "" then return nil end
  return name:match("^(.*)[\\/][^\\/]*$"), name:match("([^\\/]*)$")
end

local TYPE_NAMES = nil
local function typeName(record)
  if not TYPE_NAMES then
    TYPE_NAMES = {}
    local names = {
      { vtByte, "Byte" }, { vtWord, "2 Bytes" }, { vtDword, "4 Bytes" }, { vtQword, "8 Bytes" },
      { vtSingle, "Float" }, { vtDouble, "Double" }, { vtString, "String" }, { vtUnicodeString, "String" },
      { vtByteArray, "Bytes" }, { vtBinary, "Binary" }, { SCRIPT_TYPE, "script" }, { vtPointer, "Pointer" },
      { vtCustom, "Custom" }, { vtGrouped, "Grouped" },
    }
    for _, pair in ipairs(names) do if pair[1] ~= nil then TYPE_NAMES[pair[1]] = pair[2] end end
  end
  return TYPE_NAMES[record.Type] or "Custom"
end

-- The name of an activation-failure code, from Cheat Engine's own constants.
local function reasonName(code)
  if not REASON_NAMES then
    REASON_NAMES = {}
    for _, name in ipairs({ "afInaccessible", "afGenericAutoAssembler", "afAllocateFailure", "afSyntaxError",
        "afSyntaxErrorInLua", "afStructureDefinitionError", "afAssertFailure", "afAOBModuleNotFound",
        "afAOBNotFound", "afIncludeNotFound", "afDLLInjectionFailure" }) do
      local value = rawget(_G, name)
      if value ~= nil then REASON_NAMES[value] = name end
    end
  end
  return REASON_NAMES[code] or tostring(code)
end

-- Records why a script entry fails to activate. Cheat Engine calls
-- OnActivationFailure with its reason; a handler the table set itself still
-- runs, and decides whether to retry, as before.
local function hookFailure(record)
  if hooked[record.ID] or record.Type ~= SCRIPT_TYPE then return end
  hooked[record.ID] = true
  pcall(function()
    local own = record.OnActivationFailure
    record.OnActivationFailure = function(memrec, reason, reasonText)
      failureDetail[memrec.ID] = { reason = reasonName(reason), text = tostring(reasonText or ""):sub(1, 400) }
      log(string.format("entry %d failed to activate: %s %s", memrec.ID, reasonName(reason),
        tostring(reasonText or ""):gsub("[\r\n]+", " | ")))
      if type(own) == "function" then return own(memrec, reason, reasonText) end
      return false
    end
  end)
end

local function describe(record)
  hookFailure(record)
  local entry = {
    id = record.ID,
    desc = record.Description,
    group = record.IsGroupHeader and true or false,
    active = record.Active and true or false,
    type = typeName(record),
    error = failed[record.ID] or "",
  }
  local detail = failed[record.ID] and failureDetail[record.ID]
  if detail then
    entry.reason = detail.reason
    entry.reason_text = detail.text
  end
  if not entry.group and record.Type ~= SCRIPT_TYPE then
    local ok, value = pcall(function() return record.Value end)
    entry.value = ok and tostring(value) or "??"
    local count = record.DropDownCount or 0
    if count > 0 then
      local options = {}
      for i = 0, count - 1 do
        options[#options + 1] = { value = tostring(record.DropDownValue[i]), label = tostring(record.DropDownDescription[i]) }
      end
      entry.options = options
    end
  end
  local children = {}
  for i = 0, (record.Count or 0) - 1 do
    children[#children + 1] = describe(record.Child[i])
  end
  entry.children = children
  return entry
end

-- Cheat Engine's own process list, as the player would pick from it: Windows
-- process IDs and names inside this Proton prefix. Read about every two
-- seconds. A process "has a window" when one of its windows has a title other
-- than Wine's hidden input-method window.
local PROCESS_TICKS = 7
local processTick = 0
local processes = {}
local function readProcesses()
  local ok, found = pcall(getProcessList)
  if not ok or type(found) ~= "table" then return {} end
  local okWindows, windows = pcall(getWindowlist)
  if not okWindows or type(windows) ~= "table" then windows = {} end
  local list = {}
  for pid, name in pairs(found) do
    if type(pid) == "number" and type(name) == "string" then
      local titled = false
      if type(windows[pid]) == "table" then
        for _, title in pairs(windows[pid]) do
          if title ~= "" and title ~= "Default IME" then titled = true end
        end
      end
      list[#list + 1] = { pid = pid, name = name, window = titled }
    end
  end
  table.sort(list, function(a, b) return a.pid < b.pid end)
  return list
end

-- The attached process's name. Cheat Engine sets `process` only when it opens
-- a process itself; a table's own Lua that calls openProcess leaves it empty,
-- so the name then comes from the process list.
local function attachedName(pid)
  if pid == 0 then return "" end
  if type(process) == "string" and process ~= "" then return process end
  for _, item in ipairs(processes) do
    if item.pid == pid then return item.name end
  end
  local ok, list = pcall(getProcessList)
  if ok and type(list) == "table" and type(list[pid]) == "string" then return list[pid] end
  return ""
end

local function snapshot(fileName)
  local list = getAddressList()
  local entries = {}
  for i = 0, list.Count - 1 do
    local record = list.MemoryRecord[i]
    if record.Parent == nil then entries[#entries + 1] = describe(record) end
  end
  local pid = getOpenedProcessID() or 0
  return {
    table = fileName,
    attached = attachedName(pid),
    pid = pid,
    last_n = lastCommand,
    ts = os.time(),
    entries = entries,
    processes = processes,
    script_error = scriptError,
    injection_error = injectionError,
  }
end

-- Why an entry did not switch or take its value, shown under it in the panel:
--   detached  Cheat Engine is not attached to any process
--   exited    the attached process has ended (the game closed or crashed)
--   rejected  Cheat Engine took the change but the entry stayed off: its
--             code was usually not found, the table may not fit this version
--   error     the entry's script raised an error
--   value     the value could not be written
local function targetGone()
  local pid = getOpenedProcessID() or 0
  if pid == 0 then return "detached" end
  local ok, list = pcall(getProcessList)
  if ok and type(list) == "table" and next(list) ~= nil and list[pid] == nil then return "exited" end
  return nil
end

local function apply(command)
  local list = getAddressList()
  if type(command.attach) == "number" or type(command.attach) == "string" then
    -- A Windows process ID from the list above (or a name). The plugin sends
    -- one only before Cheat Engine is attached, or when the player picks
    -- another process in the panel; either way it is opened.
    pendingAttach = command.attach
    pcall(openProcess, command.attach)
    return
  end
  if command.all ~= nil then
    for i = list.Count - 1, 0, -1 do
      local record = list.MemoryRecord[i]
      if not record.IsGroupHeader then pcall(function() record.Active = command.all and true or false end) end
    end
    failed = {}
    failureDetail = {}
    activating = {}
    return
  end
  local id = tonumber(command.id)
  if not id then return end
  local record = list.getMemoryRecordByID(id)
  if not record then return end
  -- Set by OnActivationFailure during this switch, or not at all.
  failureDetail[id] = nil
  hookFailure(record)
  if command.value ~= nil then
    local ok = pcall(function() record.Value = tostring(command.value) end)
    failed[id] = (not ok) and (targetGone() or "value") or nil
  end
  if command.active ~= nil then
    local want = command.active and true or false
    local ok, err = pcall(function() record.Active = want end)
    activating[id] = nil
    local reason = nil
    if not ok then
      reason = targetGone() or "error"
      failureDetail[id] = failureDetail[id] or { reason = "lua", text = tostring(err):sub(1, 400) }
    elseif want and not record.Active then
      if record.Async and record.AsyncProcessing then activating[id] = true else reason = targetGone() or "rejected" end
    end
    failed[id] = reason
  end
end

local function checkActivating(list)
  for id in pairs(activating) do
    local record = list.getMemoryRecordByID(id)
    if not record then
      activating[id] = nil
    elseif not record.AsyncProcessing then
      activating[id] = nil
      if not record.Active then failed[id] = targetGone() or "rejected" end
      log(string.format("entry %d finished activating: %s", id, record.Active and "on" or "failed"))
    end
  end
end

local function summary(command)
  local parts = {}
  for _, key in ipairs({ "attach", "all", "id", "active", "value" }) do
    if command[key] ~= nil then parts[#parts + 1] = key .. "=" .. tostring(command[key]):sub(1, 40) end
  end
  return table.concat(parts, " ")
end

local function outcome(command)
  local id = tonumber(command.id)
  if not id then return "done" end
  local record = getAddressList().getMemoryRecordByID(id)
  if not record then return "no such entry" end
  local text = record.Active and "on" or "off"
  if activating[id] then text = text .. ", async still running" end
  if failed[id] then text = text .. ", failed: " .. failed[id] end
  return text
end

local function readCommands(folder)
  local file = io.open(folder .. "\\" .. RUNTIME .. "\\commands.jsonl", "r")
  if not file then return end
  for line in file:lines() do
    local command = decode(line)
    if command and type(command.n) == "number" and command.n > lastCommand then
      lastCommand = command.n
      -- Written before it runs: a command that freezes Cheat Engine is the last line.
      log("command " .. summary(command) .. ": running")
      local started = os.clock()
      local ok, err = pcall(apply, command)
      local okOutcome, result = pcall(outcome, command)
      log(string.format("command %s: %s (%d ms)", summary(command),
        ok and (okOutcome and result or "done") or ("error: " .. tostring(err)), milliseconds(started)))
    end
  end
  file:close()
end

-- Cheat Engine's open windows (its main window, a table's question, a
-- warning), written whenever they change: a question no one can see is the
-- usual reason a table seems to do nothing.
local lastWindows = nil
local function logWindows()
  if not getFormCount then return end
  local names = {}
  for i = 0, getFormCount() - 1 do
    local form = getForm(i)
    if form and form.Visible then
      names[#names + 1] = string.format('%s "%s"', form.ClassName or "?", tostring(form.Caption or ""):sub(1, 80))
    end
  end
  local text = table.concat(names, "; ")
  if text ~= lastWindows then
    lastWindows = text
    log("windows: " .. (text ~= "" and text or "none"))
  end
end

-- Errors a table's own Lua raised. Cheat Engine prints them in its Lua
-- engine window, which the game hides; often they come from a table's script
-- after its entry already switched on (onMemRecPostExecute, a timer), so the
-- entry itself does not fail. The newest error goes into the state for the
-- panel. Only output added since the last look is read.
local SCRIPT_ERROR_CHARS = 600
-- The whole error, shown when the player asks for it.
local SCRIPT_ERROR_FULL_CHARS = 6000
local seenOutput = 0

local function luaEngineOutput()
  if not getFormCount then return nil end
  for i = 0, getFormCount() - 1 do
    local form = getForm(i)
    if form and form.ClassName == "TfrmLuaEngine" then
      local ok, text = pcall(function() return form.mOutput.Lines.Text end)
      return ok and text or nil
    end
  end
  return nil
end

-- A chunk name is the whole source of a table's script; only its first line is kept.
local function shortenChunks(text)
  return (text:gsub('%[string "([^\r\n"]*)[^"]*"%]', "[%1]"))
end

-- Everything from the first error line on, with its whole traceback.
local function fullError(text)
  local lines = {}
  local started = false
  for line in shortenChunks(text):gmatch("[^\r\n]+") do
    if not started and (line:find(":%d+:") or line:find("stack traceback", 1, true)) then started = true end
    if started and line:find("%S") then lines[#lines + 1] = line end
  end
  if #lines == 0 then return nil end
  return table.concat(lines, "\n"):sub(1, SCRIPT_ERROR_FULL_CHARS)
end

-- The message line and the first frames of its traceback.
local function summarizeError(text)
  text = shortenChunks(text)
  local lines = {}
  local frames = 0
  local inTrace = false
  for line in text:gmatch("[^\r\n]+") do
    line = line:gsub("^%s+", "")
    if line ~= "" then
      if line:find("stack traceback", 1, true) then
        inTrace = true
      elseif not inTrace then
        if #lines == 0 and line:find(":%d+:") then lines[1] = line end
      elseif frames < 3 and not line:find("^%[C%]") and not line:find("decky_gcm.lua", 1, true) then
        frames = frames + 1
        lines[#lines + 1] = line
      end
    end
  end
  if #lines == 0 then return nil end
  return table.concat(lines, "\n"):sub(1, SCRIPT_ERROR_CHARS)
end

local function readScriptErrors()
  local text = luaEngineOutput()
  if not text then return end
  if #text < seenOutput then seenOutput = 0 end
  local added = text:sub(seenOutput + 1)
  seenOutput = #text
  -- Printed without a traceback, e.g. "Library Injection failed or invalid module".
  for line in added:gmatch("[^\r\n]+") do
    if line:lower():find("injection failed", 1, true) or line:lower():find("failure injecting", 1, true) then
      injectionError = { text = line:gsub("^%s+", ""):sub(1, SCRIPT_ERROR_CHARS), ts = os.time() }
      log("injection failed: " .. injectionError.text)
      break
    end
  end
  if not (added:find("stack traceback", 1, true) or added:find('%[string ".-"%]:%d+:')) then return end
  local message = summarizeError(added)
  if message then
    scriptError = { text = message, full = fullError(added) or message, ts = os.time() }
    log("table script error: " .. message:gsub("\n", " | "))
  end
end

local function writeState(folder, fileName)
  local text = encode(snapshot(fileName))
  if text == lastState then return end
  local target = folder .. "\\" .. RUNTIME .. "\\state.json"
  local temporary = target .. ".tmp"
  local file = io.open(temporary, "w")
  if not file then return end
  file:write(text)
  file:close()
  os.remove(target)
  if os.rename(temporary, target) then lastState = text end
end

-- Under Proton the 64-bit Cheat Engine lists no modules of a 32-bit game, so
-- every "game.exe+offset" address and aobscanmodule fails although memory
-- reads work; the 32-bit build sees them. Once attached to a 32-bit process,
-- the 64-bit build has the starter (a system process again) start the 32-bit
-- one with the same table, and closes. The starter takes both paths from the
-- variables its first start left in this Cheat Engine's environment, in
-- UTF-16, so no path in another language passes through Lua's ANSI strings.
-- The new one replays the plugin's attach command, or the table's Lua
-- attaches it again. The 32-bit build never switches, so this happens at most
-- once. Each newly attached process is checked once.
--
-- Nothing here runs code inside Cheat Engine (executeCodeLocal): under
-- ARM64 Wine that never returned and froze Cheat Engine with the game.
local checkedPid = 0

-- Returns true when this Cheat Engine is closing for the 32-bit one.
local function switchTo32Bit()
  local pid = getOpenedProcessID() or 0
  if pid == 0 or pid == checkedPid then return false end
  checkedPid = pid
  if not (cheatEngineIs64Bit and cheatEngineIs64Bit()) or not targetIs64Bit or targetIs64Bit() then return false end
  local starter = os.getenv("GCM_STARTER")
  if not starter or starter == "" or not runCommand then
    log("32-bit game: no starter, staying in the 64-bit Cheat Engine")
    return false
  end
  -- The starter exits once the 32-bit build runs; 0 means it started.
  local ok, _, code = pcall(runCommand, starter, { "--ce-i386" })
  if not ok or code ~= 0 then
    log("32-bit game: the starter could not start cheatengine-i386.exe (" .. tostring(ok and code or _)
      .. "), staying in the 64-bit Cheat Engine")
    return false
  end
  log("32-bit game: switched to cheatengine-i386.exe")
  closeCE()
  return true
end

local function tick()
  local folder, fileName = tableFolder()
  if not folder then return end
  if pendingAttach and getOpenedProcessID() == 0 then
    pcall(openProcess, pendingAttach)
  else
    pendingAttach = nil
  end
  local switchOk, switching = pcall(switchTo32Bit)
  if not switchOk then log("32-bit switch failed: " .. tostring(switching)) end
  if switchOk and switching then return end
  readCommands(folder)
  pcall(checkActivating, getAddressList())
  pcall(logWindows)
  pcall(readScriptErrors)
  processTick = processTick - 1
  if processTick <= 0 then
    processes = readProcesses()
    processTick = PROCESS_TICKS
  end
  writeState(folder, fileName)
end

-- Each tick runs on Cheat Engine's main thread, which also draws its windows:
-- a slow one is written down, and every HEARTBEAT_SECONDS a line says the
-- bridge still runs. A gap in these lines is a time Cheat Engine was frozen.
-- Returns the tick's milliseconds.
local SLOW_TICK_MS = 250
local HEARTBEAT_SECONDS = 30
local ticks, slowest, lastHeartbeat = 0, 0, os.time()
local function measuredTick()
  local started = os.clock()
  local ok, err = pcall(tick)
  if not ok then log("tick failed: " .. tostring(err)) end
  local spent = milliseconds(started)
  ticks = ticks + 1
  if spent > slowest then slowest = spent end
  if spent >= SLOW_TICK_MS then log(string.format("slow tick: %d ms", spent)) end
  local now = os.time()
  if now - lastHeartbeat >= HEARTBEAT_SECONDS then
    local pid = getOpenedProcessID() or 0
    log(string.format("alive: %d ticks in %d s, slowest %d ms; attached %s; %d records",
      ticks, now - lastHeartbeat, slowest, pid ~= 0 and (attachedName(pid) .. " pid " .. pid) or "nothing",
      getAddressList().Count))
    ticks, slowest, lastHeartbeat = 0, 0, now
  end
  return spent
end

-- Newer Cheat Engine versions turn on a check (autorun/threadsafegui.lua) that
-- stops a table's async Lua at its first GUI access with a question. Many
-- older tables do that, and under a game the question cannot be answered, so
-- the check stays off as in older versions. Autorun order is not defined: it
-- is turned off here and again once every autorun script has run.
local function allowUnsafeGui()
  if setThreadSafetyCheck then pcall(setThreadSafetyCheck, false) end
end

-- Cheat Engine refuses a signed table under Wine (it cannot check the
-- signature there) and says nothing. The launcher does not give it a table
-- with a <Signature> element and sets GCM_UNSIGN: the table is opened here
-- with that element removed. Its Lua runs without asking, as the launcher
-- has Cheat Engine do for every other table.
local function openUnsigned()
  local name = os.getenv("GCM_TABLE")
  local file = io.open(name, "rb")
  if not file then log("signed table: cannot read " .. tostring(name)); return end
  local text = file:read("*a")
  file:close()
  local removed
  text, removed = text:gsub("<Signature%s*/>", "")
  local blocks
  text, blocks = text:gsub("<Signature[%s>].-</Signature>", "")
  local stream = createStringStream(text)
  local ok, loaded = pcall(loadTable, stream, false, true)
  stream.destroy()
  log("signed table: removed " .. (removed + blocks) .. " signature(s); loadTable "
    .. (ok and tostring(loaded) or ("failed: " .. tostring(loaded)))
    .. "; " .. getAddressList().Count .. " records")
end

log("---- loaded in Cheat Engine " .. tostring(getCEVersion and getCEVersion() or "?")
  .. "; GCM_TABLE=" .. tostring(os.getenv("GCM_TABLE")))
-- The timer stops while a tick runs and starts again after it, waiting at
-- least as long as the tick took. Under Wine a timer that is due again as
-- soon as a tick ends (a big table's ticks are slower than INTERVAL on a
-- handheld) leaves no idle time to read input: Cheat Engine's own dialogs
-- then ignore every tap, click and key until the ticks get faster.
if tableFolder() then
  allowUnsafeGui()
  local first = true
  local timer = createTimer(nil, false)
  timer.Interval = INTERVAL
  local function run()
    if first then
      first = false
      allowUnsafeGui()
      if os.getenv("GCM_UNSIGN") == "1" then
        local ok, err = pcall(openUnsigned)
        if not ok then log("signed table failed: " .. tostring(err)) end
      end
      log(string.format("first tick: %d records", getAddressList().Count))
    end
    return measuredTick()
  end
  timer.OnTimer = function()
    timer.Enabled = false
    local ok, spent = pcall(run)
    timer.Interval = math.max(INTERVAL, ok and tonumber(spent) or 0)
    timer.Enabled = true
  end
  timer.Enabled = true
end
