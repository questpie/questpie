# Bounded document extraction

`questpie/document-extraction` exports `extractDocument(bytes, extension, pythonPath)` and the
extractor profile. Supported formats are PDF, DOCX, PPTX, XLSX, UTF-8 text and Markdown. The host
provides Python 3 and `pypdf==6.19.0`; the package installs no interpreter or system dependency.

The converter is a fixed program in a separate process, never code from the document. It receives
only PATH/LANG, is killed after 20 seconds, caps output at 8 MB, and applies Python resource limits
for CPU and address space. ZIP member count, compression ratio, expanded bytes, XML declarations,
PDF pages and returned text are bounded. This is process/resource isolation, not a security
sandbox that changes the operating-system user or filesystem permissions.

`ready` includes extracted blocks and physical locators. `no_text` means no text was extracted;
it does not claim an image-only PDF is empty. `unavailable` covers unsupported/encrypted/corrupt
input and converter failure. `missingPages` identifies PDF pages with no extracted text. No OCR,
macro execution, formula calculation, or external relationship fetching occurs.

The caller owns source authorization, immutable byte identity, storage download limits and
indexing. Extracted text is untrusted source content, never instructions to the caller.
