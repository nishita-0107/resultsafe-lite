import csv, io, re, urllib.parse, datetime
import boto3

s3 = boto3.client('s3')
table = boto3.resource('dynamodb').Table('resultsafe-results')

HEADER = ['roll', 'name', 'hash', 'maths', 'physics', 'networks']
ROLL = re.compile(r'^[A-Za-z0-9]{1,10}$')
HASH = re.compile(r'^[^:,\s]{1,64}:[0-9a-f]{64}$')


def check(rows):
    errors = []
    if len(rows) < 1 or len(rows) > 500:
        errors.append('Row count must be between 1 and 500, got %d' % len(rows))
    seen = set()
    for n, r in enumerate(rows, start=2):
        if len(r) != 6:
            errors.append('Line %d: expected 6 columns' % n)
            continue
        roll, name, h, *marks = [x.strip() for x in r]
        if not ROLL.match(roll):
            errors.append('Line %d: bad roll number' % n)
        if roll in seen:
            errors.append('Line %d: duplicate roll %s' % (n, roll))
        seen.add(roll)
        if not name or len(name) > 60:
            errors.append('Line %d: name missing or too long' % n)
        if not HASH.match(h):
            errors.append('Line %d: PIN hash has the wrong format' % n)
        for m in marks:
            if not m.isdigit() or int(m) > 100:
                errors.append('Line %d: marks must be whole numbers 0 to 100' % n)
                break
    return errors[:10]


def handler(event, context):
    for rec in event['Records']:
        bucket = rec['s3']['bucket']['name']
        key = urllib.parse.unquote_plus(rec['s3']['object']['key'])
        text = s3.get_object(Bucket=bucket, Key=key)['Body'].read().decode('utf-8')
        reader = list(csv.reader(io.StringIO(text)))
        status = {'roll': '__lastupload__', 'file': key,
                  'time': datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}
        if not reader or reader[0] != HEADER:
            status.update(status='REJECTED', errors=['Header must be ' + ','.join(HEADER)])
        else:
            errors = check(reader[1:])
            if errors:
                status.update(status='REJECTED', errors=errors)
            else:
                with table.batch_writer() as batch:
                    for roll, name, h, ma, ph, ne in [[x.strip() for x in r] for r in reader[1:]]:
                        batch.put_item(Item={'roll': roll, 'name': name, 'hash': h,
                                             'maths': ma, 'physics': ph, 'networks': ne})
                status.update(status='LOADED', count=len(reader) - 1, errors=[])
        table.put_item(Item=status)
    return 'done'
