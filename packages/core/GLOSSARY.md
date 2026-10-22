# Core

The base of Celestia: it loads Modules and connects them. Functionality beyond identity and permissions arrives as Plugins.

## Language

**Base System**:
What every client's build contains: the Core and IAM.
_Avoid_: Platform, kernel

**Plugin**:
A piece of functionality a client buys and that is included in that client's build, such as ERP or InovaFarma. A Plugin may depend on other Plugins, and including it brings its dependencies into the build.
_Avoid_: Integration, extension, add-on

**Module**:
The technical unit the Core loads and connects, with its own routes, permissions and data. IAM and every Plugin are Modules.
_Avoid_: Package, library
