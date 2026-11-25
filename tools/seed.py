"""Load results.csv and the teacher password into DynamoDB.
Usage: python3 tools/seed.py results.csv 'TeacherPassword'
Hash format matches server.js: salt:hex(scrypt(password, salt, 32)) with N=16384, r=8, p=1."""
import csv, hashlib, os, sys
import boto3

if len(sys.argv) != 3:
    sys.exit("usage: python3 tools/seed.py results.csv 'TeacherPassword'")
table = boto3.resource('dynamodb').Table('resultsafe-results')
with open(sys.argv[1], newline='') as f, table.batch_writer() as batch:
    n = 0
    for r in csv.DictReader(f):
        batch.put_item(Item={'roll': r['roll'], 'name': r['name'], 'hash': r['hash'],
                             'maths': r['maths'], 'physics': r['physics'], 'networks': r['networks']})
        n += 1
salt = os.urandom(8).hex()
h = hashlib.scrypt(sys.argv[2].encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=32).hex()
table.put_item(Item={'roll': '__admin__', 'hash': salt + ':' + h})
print('loaded', n, 'students and the teacher password')
