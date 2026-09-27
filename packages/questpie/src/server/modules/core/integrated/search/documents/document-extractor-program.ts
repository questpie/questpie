/** CANON EXEC-29: bounded conversion runs outside Agent Runs and receives no credentials. */
export const DOCUMENT_EXTRACTOR_PROGRAM = String.raw`
import io, json, resource, sys, zipfile, re, posixpath
import xml.etree.ElementTree as ET

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
MAX_BYTES = 25 * 1024 * 1024
MAX_TEXT = 1000000
blocks = []
total = 0

def emit(text, locator):
    global total
    text = text.strip()
    if not text:
        return
    total += len(text)
    if total > MAX_TEXT or len(blocks) >= 4096:
        raise ValueError('limit')
    blocks.append({'text': text, 'locator': locator})

def xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('unsafe_xml')
    return ET.fromstring(data)

def office(data, kind):
    z = zipfile.ZipFile(io.BytesIO(data))
    entries = z.infolist()
    if len(entries) > 10000 or sum(e.file_size for e in entries) > 64 * 1024 * 1024:
        raise ValueError('limit')
    if any(e.file_size > 16 * 1024 * 1024 or e.file_size > max(1024 * 1024, e.compress_size * 200) for e in entries):
        raise ValueError('limit')
    def read(name):
        with z.open(name) as f:
            result = f.read(16 * 1024 * 1024 + 1)
        if len(result) > 16 * 1024 * 1024:
            raise ValueError('limit')
        return xml(result)
    def text(node):
        return ''.join(t.text or '' for t in node.iter() if t.tag.rsplit('}', 1)[-1] == 't')
    def relationships(part):
        path = posixpath.dirname(part) + '/_rels/' + posixpath.basename(part) + '.rels'
        if path not in z.namelist():
            return {}
        result = {}
        for rel in read(path):
            if rel.attrib.get('TargetMode') == 'External':
                continue
            target = rel.attrib.get('Target', '')
            resolved = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(part), target))
            if resolved.startswith('../'):
                raise ValueError('invalid_relationship')
            result[rel.attrib['Id']] = (resolved, rel.attrib.get('Type', ''))
        return result
    if kind == 'docx':
        root = read('word/document.xml')
        body = root.find('{*}body')
        heading = ''
        for position, node in enumerate(body):
            tag = node.tag.rsplit('}', 1)[-1]
            if tag == 'p':
                value = text(node)
                style = node.find('{*}pPr/{*}pStyle')
                if style is not None and any('heading' in v.lower() for v in style.attrib.values()):
                    heading = value[:300]
                emit(value, {'paragraph': position + 1, 'section': heading})
            elif tag == 'tbl':
                rows = node.findall('{*}tr')
                header = ''
                for rowno, row in enumerate(rows):
                    value = ' | '.join(text(cell) for cell in row.findall('{*}tc'))
                    if rowno == 0:
                        header = value
                    emit((header + '\n' if rowno else '') + value, {'table': position + 1, 'row': rowno + 1, 'section': heading})
    elif kind == 'pptx':
        rels = relationships('ppt/presentation.xml')
        slides = read('ppt/presentation.xml').findall('{*}sldIdLst/{*}sldId')
        for position, slide in enumerate(slides):
            rel = slide.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            name, relation = rels[rel]
            if not name.startswith('ppt/slides/') or not relation.endswith('/slide'):
                raise ValueError('invalid_slide')
            number = position + 1
            root = read(name)
            emit('\n'.join(text(p) for p in root.findall('.//{*}p')), {'slide': number})
            for notes, relation in relationships(name).values():
                if relation.endswith('/notesSlide') and notes.startswith('ppt/notesSlides/'):
                    emit('\n'.join(text(p) for p in read(notes).findall('.//{*}p')), {'slide': number, 'part': 'notes'})
    elif kind == 'xlsx':
        strings = [text(n) for n in read('xl/sharedStrings.xml')] if 'xl/sharedStrings.xml' in z.namelist() else []
        rels = {n.attrib['Id']: n.attrib['Target'] for n in read('xl/_rels/workbook.xml.rels') if n.attrib.get('TargetMode') != 'External'}
        for sheet in read('xl/workbook.xml').findall('{*}sheets/{*}sheet'):
            rel = sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = rels.get(rel, '')
            name = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            if '..' in name.split('/') or not name.startswith('xl/worksheets/'):
                raise ValueError('invalid_sheet')
            for row in read(name).findall('.//{*}sheetData/{*}row'):
                cells = []
                for cell in row.findall('{*}c'):
                    value = cell.findtext('{*}v', '')
                    if cell.attrib.get('t') == 's':
                        value = strings[int(value)]
                    elif cell.attrib.get('t') == 'inlineStr':
                        value = text(cell)
                    cells.append(cell.attrib.get('r', '') + ': ' + value)
                emit(' | '.join(cells), {'sheet': sheet.attrib['name'], 'row': int(row.attrib.get('r', 0))})

try:
    kind = sys.argv[1]
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('limit')
    missing_pages = []
    if kind == 'pdf':
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError('encrypted')
        if len(reader.pages) > 300:
            raise ValueError('limit')
        for number, page in enumerate(reader.pages):
            value = page.extract_text(extraction_mode='layout') if '/Contents' in page else ''
            if not value.strip():
                missing_pages.append(number + 1)
            for part, paragraph in enumerate(re.split(r'\n\s*\n', value)):
                emit(paragraph, {'page': number + 1, 'block': part + 1})
    elif kind in ('txt', 'md', 'markdown'):
        value = data.decode('utf-8-sig')
        if '\x00' in value:
            raise ValueError('binary_text')
        for number, paragraph in enumerate(re.split(r'\n\s*\n', value)):
            emit(paragraph, {'paragraph': number + 1})
    elif kind in ('docx', 'pptx', 'xlsx'):
        office(data, kind)
    else:
        raise ValueError('unsupported')
    print(json.dumps({'status': 'ready' if blocks else 'no_text', 'blocks': blocks, 'missingPages': missing_pages}, ensure_ascii=False))
except Exception:
    print(json.dumps({'status': 'unavailable', 'blocks': [], 'missingPages': []}))
`;
