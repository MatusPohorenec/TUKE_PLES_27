import json, sys
sys.path.insert(0, sys.argv[1])
from qrcore import Symbol
ref = json.load(open(sys.argv[2]))
url = b'https://srdcom.tuke.sk/onboarding/'
bad = 0
for key, rows in ref.items():
    version, ecl, mask = int(key[0]), key[1], int(key[2])
    s = Symbol(version, ecl)
    data, used = s.message_codewords(url)
    m = s.build(data, mask)
    mine = [''.join(map(str, r)) for r in m]
    diff = sum(a != b for r1, r2 in zip(mine, rows) for a, b in zip(r1, r2))
    if diff:
        bad += 1
        print(key, 'differs in', diff, 'modules')
print('checked', len(ref), 'bad', bad)
s = Symbol(5, 'L')
print('v5-L: n', s.n, 'data cw', s.num_data, 'blocks', s.block_data, 'ecc', s.ecc_len, 'message cw', s.message_codewords(url)[1])
