Cowork Desktop local shell bundle

This is a thin local wrapper bundle for the current local pilot product surface.
It is not a signed native installer and it does not bundle new business logic.
It launches the existing local cowork surface through desktop/launch-shell.mjs.
App version: 0.1.0
Build id: desktop-shell-1776954010652
Support status: local_pilot_only
Bundle variant: browser_app_wrapper
Window title: Cowork Desktop | Local pilot

Included assets:
  assets\cowork-mark.svg

Smoke:
  powershell -ExecutionPolicy Bypass -File .\launch-cowork-desktop.ps1 -DryRun