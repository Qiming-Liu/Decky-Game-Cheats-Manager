-- DeckyGCM bridge. Cheat Engine loads every autorun/*.lua at start; this one
-- lets the plugin's Quick Access panel read and switch the open table's
-- entries while a game runs.
--
-- The launcher starts Cheat Engine with GCM_TABLE set to the table's path.
-- Next to that table, in `.gcm-runtime/`:
--   commands.jsonl  one command per line, appended by the plugin:
--                   {"n":1,"id":1034,"active":true}  {"n":2,"id":1041,"value":"100"}
--                   {"n":3,"all":false}  {"n":4,"attach":"game.exe"}
--   state.json      the whole entry tree and the attached process, written here
--                   whenever something changed.
-- Commands carry a rising number; each is applied once.

local RUNTIME = ".gcm-runtime"
local INTERVAL = 300

local lastCommand = 0
local lastState = nil
local failed = {}
local pendingAttach = nil
local SCRIPT_TYPE = vtAutoAssembler or 11

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

local function describe(record)
  local entry = {
    id = record.ID,
    desc = record.Description,
    group = record.IsGroupHeader and true or false,
    active = record.Active and true or false,
    type = typeName(record),
    error = failed[record.ID] or "",
  }
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
    attached = (pid ~= 0 and process) and tostring(process) or "",
    pid = pid,
    last_n = lastCommand,
    ts = os.time(),
    entries = entries,
  }
end

local function apply(command)
  local list = getAddressList()
  if type(command.attach) == "string" then
    if getOpenedProcessID() == 0 then
      pendingAttach = command.attach
      pcall(openProcess, command.attach)
    end
    return
  end
  if command.all ~= nil then
    for i = list.Count - 1, 0, -1 do
      local record = list.MemoryRecord[i]
      if not record.IsGroupHeader then pcall(function() record.Active = command.all and true or false end) end
    end
    failed = {}
    return
  end
  local id = tonumber(command.id)
  if not id then return end
  local record = list.getMemoryRecordByID(id)
  if not record then return end
  if command.value ~= nil then
    local ok = pcall(function() record.Value = tostring(command.value) end)
    if ok then failed[id] = nil else failed[id] = "value" end
  end
  if command.active ~= nil then
    local want = command.active and true or false
    local ok = pcall(function() record.Active = want end)
    if ok and want and not record.Active then ok = false end
    if ok then failed[id] = nil else failed[id] = "activate" end
  end
end

local function readCommands(folder)
  local file = io.open(folder .. "\\" .. RUNTIME .. "\\commands.jsonl", "r")
  if not file then return end
  for line in file:lines() do
    local command = decode(line)
    if command and type(command.n) == "number" and command.n > lastCommand then
      lastCommand = command.n
      pcall(apply, command)
    end
  end
  file:close()
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

local function tick()
  local folder, fileName = tableFolder()
  if not folder then return end
  if pendingAttach and getOpenedProcessID() == 0 then
    pcall(openProcess, pendingAttach)
  else
    pendingAttach = nil
  end
  readCommands(folder)
  writeState(folder, fileName)
end

if tableFolder() then
  local timer = createTimer(nil, false)
  timer.Interval = INTERVAL
  timer.OnTimer = function() pcall(tick) end
  timer.Enabled = true
end
