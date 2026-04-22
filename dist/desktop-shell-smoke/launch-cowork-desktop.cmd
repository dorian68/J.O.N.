@echo off
setlocal
set REPO_ROOT=%~dp0..\..
pushd %REPO_ROOT%
node desktop\launch-shell.mjs
set EXITCODE=%ERRORLEVEL%
popd
exit /b %EXITCODE%