# A small QR encoder (byte mode, versions 1-9) that shows what a library hides: the block, codeword and bit behind
# every module, and the data codewords after the message, which a reader never decodes (the terminator ends the
# text), so they may hold any value. After ISO/IEC 18004 as written down in Nayuki's reference implementation.
ECL_FORMAT = {'L': 1, 'M': 0, 'Q': 3, 'H': 2}
ECC_PER_BLOCK = {'L': [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30], 'M': [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22],
                 'Q': [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20], 'H': [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24]}
NUM_BLOCKS = {'L': [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2], 'M': [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5],
              'Q': [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8], 'H': [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8]}
MASKS = [lambda x, y: (x + y) % 2, lambda x, y: y % 2, lambda x, y: x % 3, lambda x, y: (x + y) % 3,
         lambda x, y: (x // 3 + y // 2) % 2, lambda x, y: x * y % 2 + x * y % 3,
         lambda x, y: (x * y % 2 + x * y % 3) % 2, lambda x, y: ((x + y) % 2 + x * y % 3) % 2]  # invert where 0


def rs_mul(x, y):
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = rs_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = rs_mul(root, 0x02)
    return result


def rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= rs_mul(coef, factor)
    return result


def raw_data_modules(ver):
    result = (16 * ver + 128) * ver + 64
    if ver >= 2:
        na = ver // 7 + 2
        result -= (25 * na - 10) * na - 55
        if ver >= 7:
            result -= 36
    return result


class Symbol:
    """One version + error correction level: function patterns, the module of every stream bit, the blocks."""

    def __init__(self, version, ecl):
        self.version, self.ecl = version, ecl
        self.n = n = version * 4 + 17
        self.func = [[False] * n for _ in range(n)]
        self.fixed = [[0] * n for _ in range(n)]
        self._function_patterns()
        self.raw_codewords = raw_data_modules(version) // 8
        self.num_blocks = NUM_BLOCKS[ecl][version]
        self.ecc_len = ECC_PER_BLOCK[ecl][version]
        self.num_short = self.num_blocks - self.raw_codewords % self.num_blocks
        self.short_len = self.raw_codewords // self.num_blocks
        # data codewords per block, and where each block's data starts in the data sequence
        self.block_data = [self.short_len - self.ecc_len + (0 if i < self.num_short else 1) for i in range(self.num_blocks)]
        self.num_data = sum(self.block_data)
        self.block_start = [sum(self.block_data[:i]) for i in range(self.num_blocks)]
        # stream codeword index -> (block, index inside the block: data first, then the block's EC)
        self.stream_map = []
        for i in range(self.short_len + 1):
            for j in range(self.num_blocks):
                if i != self.short_len - self.ecc_len or j >= self.num_short:
                    self.stream_map.append((j, i if (j >= self.num_short or i < self.short_len - self.ecc_len) else i - 1))
        assert len(self.stream_map) == self.raw_codewords
        # the zigzag: (row, col) of every stream bit, in order
        self.positions = []
        for right in range(n - 1, 0, -2):
            if right <= 6:
                right -= 1
            for vert in range(n):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = (n - 1 - vert) if upward else vert
                    if not self.func[y][x] and len(self.positions) < self.raw_codewords * 8:
                        self.positions.append((y, x))
        assert len(self.positions) == self.raw_codewords * 8

    # ------------------------------------------------------------------ function patterns
    def _set(self, x, y, dark):
        self.fixed[y][x] = 1 if dark else 0
        self.func[y][x] = True

    def alignment_positions(self):
        ver = self.version
        if ver == 1:
            return []
        na = ver // 7 + 2
        step = (ver * 8 + na * 3 + 5) // (na * 4 - 4) * 2
        return list(reversed([self.n - 7 - i * step for i in range(na - 1)] + [6]))

    def _function_patterns(self):
        n = self.n
        for i in range(n):
            self._set(6, i, i % 2 == 0)
            self._set(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    xx, yy = cx + dx, cy + dy
                    if 0 <= xx < n and 0 <= yy < n:
                        self._set(xx, yy, max(abs(dx), abs(dy)) not in (2, 4))
        pos = self.alignment_positions()
        na = len(pos)
        for i in range(na):
            for j in range(na):
                if (i, j) not in ((0, 0), (0, na - 1), (na - 1, 0)):
                    for dy in range(-2, 3):
                        for dx in range(-2, 3):
                            self._set(pos[i] + dx, pos[j] + dy, max(abs(dx), abs(dy)) != 1)
        self.format_cells = self._format_cells()
        for (x, y) in self.format_cells[0] + self.format_cells[1]:
            self._set(x, y, False)  # reserved; written per mask
        self._set(8, n - 8, True)  # the dark module
        if self.version >= 7:
            rem = self.version
            for _ in range(12):
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
            bits = self.version << 12 | rem
            for i in range(18):
                bit = (bits >> i) & 1
                a, b = n - 11 + i % 3, i // 3
                self._set(a, b, bit)
                self._set(b, a, bit)

    def _format_cells(self):
        """(x, y) of format bit 0..14, first copy (around the top left finder) and second copy."""
        n = self.n
        first = [(8, i) for i in range(6)] + [(8, 7), (8, 8), (7, 8)] + [(14 - i, 8) for i in range(9, 15)]
        second = [(n - 1 - i, 8) for i in range(8)] + [(8, n - 15 + i) for i in range(8, 15)]
        return first, second

    def format_bits(self, mask):
        data = ECL_FORMAT[self.ecl] << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        return (data << 10 | rem) ^ 0x5412

    # ------------------------------------------------------------------ data
    def message_codewords(self, payload: bytes):
        """Byte mode, standard padding. Returns (data codewords, number of codewords the message needs)."""
        assert self.version <= 9
        bits = [0, 1, 0, 0] + [(len(payload) >> i) & 1 for i in range(7, -1, -1)]
        for b in payload:
            bits += [(b >> i) & 1 for i in range(7, -1, -1)]
        cap = self.num_data * 8
        assert len(bits) <= cap, 'message too long'
        bits += [0] * min(4, cap - len(bits))
        bits += [0] * (-len(bits) % 8)
        used = len(bits) // 8
        data = [int(''.join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
        pad = 0xEC
        while len(data) < self.num_data:
            data.append(pad)
            pad ^= 0xEC ^ 0x11
        return data, used

    def blocks_of(self, data):
        div = rs_divisor(self.ecc_len)
        out = []
        for j in range(self.num_blocks):
            d = data[self.block_start[j]:self.block_start[j] + self.block_data[j]]
            out.append(list(d) + rs_remainder(d, div))
        return out

    def build(self, data, mask):
        """The module matrix (rows of 0/1) for the data codewords and mask."""
        n = self.n
        blocks = self.blocks_of(data)
        stream = [blocks[j][i] for (j, i) in self.stream_map]
        m = [row[:] for row in self.fixed]
        for k, (y, x) in enumerate(self.positions):
            m[y][x] = (stream[k >> 3] >> (7 - (k & 7))) & 1
        f = MASKS[mask]
        for y in range(n):
            for x in range(n):
                if not self.func[y][x] and f(x, y) == 0:
                    m[y][x] ^= 1
        bits = self.format_bits(mask)
        for copy in self.format_cells:
            for i, (x, y) in enumerate(copy):
                m[y][x] = (bits >> i) & 1
        m[n - 8][8] = 1
        return m

    def module_owner(self):
        """(row, col) -> (block, index in block, bit 0 = MSB) for every data module."""
        own = {}
        for k, (y, x) in enumerate(self.positions):
            own[(y, x)] = self.stream_map[k >> 3] + (k & 7,)
        return own
