# List sa svim Security stranicama (snimci 1440 x 900 umanjeni, telefon 390 x 844), sa brojem i nazivom
import sys, os
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from PIL import Image, ImageDraw, ImageFont

D = os.path.join(os.path.dirname(__file__), 'snimci')
DESK = [
    ('01-uzivo', 'Uživo'), ('02-raspored', 'Raspored (nedelja, pokrivenost)'), ('03-smena', 'Detalj smene (fioka)'),
    ('04-objekti', 'Objekti (sada + priprema)'), ('05-objekat', 'Objekat: pregled'), ('06-obilazak', 'Objekat: plan obilaska'),
    ('07-tagovi', 'Objekat: NFC tagovi'), ('08-radnici', 'Radnici'), ('09-dosije', 'Dosije radnika (fioka)'),
    ('10-alarmi', 'Alarmi: dnevnik'), ('11-pravila', 'Alarmi: pravila'), ('12-izvestaji', 'Izveštaji'),
    ('13-dnevnik-rada', 'Izveštaj: Dnevnik rada'), ('14-satnica', 'Satnica'), ('18-radnik-web', 'Web za radnika')
]
PHONE = [('15-telefon-uzivo', 'Telefon: Uživo'), ('16-telefon-raspored', 'Telefon: Raspored'), ('17-telefon-objekat', 'Telefon: Objekat')]

W, H, PAD, LAB = 720, 450, 22, 46
cols = 3
rows = (len(DESK) + cols - 1) // cols
PW, PH = 250, 541
sheet_w = cols * W + (cols + 1) * PAD
sheet_h = 80 + rows * (H + LAB + PAD) + PAD + (PH + LAB + PAD)
sheet = Image.new('RGB', (sheet_w, sheet_h), (244, 244, 242))
d = ImageDraw.Draw(sheet)
ft = ImageFont.truetype('arialbd.ttf', 30)
fl = ImageFont.truetype('arialbd.ttf', 21)
d.text((PAD, 26), 'Robotik Security: sve stranice u novom izgledu (Papir i tuš, znakovi ISO)', fill=(20, 20, 20), font=ft)

def paste(name, label, x, y, w, h, n):
    p = os.path.join(D, f'{name}.png')
    if not os.path.exists(p):
        return
    d.rounded_rectangle((x - 1, y - 1, x + w + 1, y + LAB + h + 1), radius=14, fill=(255, 255, 255), outline=(220, 220, 216))
    d.text((x + 14, y + 12), f'{n}. {label}', fill=(15, 15, 15), font=fl)
    im = Image.open(p).convert('RGB').resize((w, h), Image.LANCZOS)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=10, fill=255)
    sheet.paste(im, (x, y + LAB), mask)

for i, (name, label) in enumerate(DESK):
    x = PAD + (i % cols) * (W + PAD)
    y = 80 + (i // cols) * (H + LAB + PAD)
    paste(name, label, x, y, W, H, i + 1)
y = 80 + rows * (H + LAB + PAD)
for j, (name, label) in enumerate(PHONE):
    x = PAD + j * (PW + PAD * 2)
    paste(name, label, x, y, PW, PH, len(DESK) + j + 1)
out = os.path.join(os.path.dirname(__file__), 'snimci', 'sve-stranice.png')
sheet.save(out, optimize=True)
print(sheet.size, out)
