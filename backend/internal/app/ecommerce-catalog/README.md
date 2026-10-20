# EcomGen suite catalog

Source: https://github.com/linbei0/EcomGen/tree/f8e6e7b52c1ff74a614052728ccb24c2b4c5e7b6/packages/ecom-suite/src/suites

The gzip resource contains all 1173 source JSON documents, sorted by filename.
The source package has no separate license; the repository MIT license is retained
in LICENSE.txt. The ecom-skill and ecom-suite-forge upstream texts are not included.

Rebuild using a clean checkout at the pinned commit:

```sh
python3 scripts/import-ecomgen-catalog.py /path/to/EcomGen
```

The service projects visual directions and complete shot references into editable
templates. It does not implement upstream PIXEL_PROTECTED generation, and template
product claims must be rewritten against the current verified product facts.
