import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Replace interactive input and Node launch; never connect to a real device.
function launch(inputs, args = '--web', credentials = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^T830_/i.test(key)));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `
    $ErrorActionPreference = 'Stop'
    $global:answers = [Collections.Generic.Queue[string]]::new()
    foreach ($answer in (ConvertFrom-Json $env:TEST_INPUTS)) { $global:answers.Enqueue($answer) }
    function Read-Host { param($Prompt, [switch]$AsSecureString)
      if ($global:answers.Count -eq 0) { throw "Unexpected credential prompt: $Prompt" }
      $value = $global:answers.Dequeue()
      $secure = [Security.SecureString]::new()
      foreach ($character in $value.ToCharArray()) { $secure.AppendChar($character) }
      return $secure
    }
    function Get-Command { param($Name, $ErrorAction) return @{ Source = 'Invoke-TestNode' } }
    function Invoke-TestNode {
      [ordered]@{ mode = $env:T830_AUTH_MODE; password = [bool]$env:T830_PASSWORD;
        developerKey = [bool]$env:T830_DEVELOPER_KEY; arguments = @($args);
        remainingInputs = $global:answers.Count } | ConvertTo-Json -Compress
      $global:LASTEXITCODE = 0
    }
    & $env:TEST_START_SCRIPT ${args}
  `], { env: { ...env, ...credentials, TEST_INPUTS: JSON.stringify(inputs),
    TEST_START_SCRIPT: fileURLToPath(new URL('../scripts/start-agent.ps1', import.meta.url)) }, encoding: 'utf8' });
  return { ...result, launched: result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line))[0] };
}

test('startup: optional second credential selects admin or developer for web', { skip: process.platform !== 'win32' }, () => {
  for (const [second, mode] of [['', 'admin'], ['bW9jay1rZXk=', 'developer']]) {
    const result = launch(['mock-admin-password', second]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.launched.mode, mode);
    assert.equal(result.launched.password, true);
    assert.equal(result.launched.developerKey, mode === 'developer');
    assert.equal(result.launched.remainingInputs, 0);
    assert.match(result.launched.arguments[0], /media\.mjs$/);
    assert.equal(result.launched.arguments[1], '--agent');
  }
});

test('startup: explicit developer requires second credential', { skip: process.platform !== 'win32' }, () => {
  const result = launch(['mock-admin-password', ''], '--developer --web');
  assert.notEqual(result.status, 0);
  assert.equal(result.launched, undefined);
});

test('startup: environment credentials are reused and CLI receives no developer flag', { skip: process.platform !== 'win32' }, () => {
  const result = launch([], '--developer --once example', { T830_PASSWORD: 'mock-admin-password', T830_DEVELOPER_KEY: 'bW9jay1rZXk=' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.launched.mode, 'developer');
  assert.deepEqual(result.launched.arguments.slice(1), ['--once', 'example']);
});

test('startup: skip device connection with empty first credential', { skip: process.platform !== 'win32' }, () => {
  const result = launch(['']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.launched.password, false);
  assert.equal(result.launched.mode, 'admin');
});

