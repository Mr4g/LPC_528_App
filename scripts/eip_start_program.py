import socket
import struct
import binascii
import sys
import time
import os

IP = os.getenv("LPC_EIP_HOST", "192.168.200.50")
PORT = int(os.getenv("LPC_EIP_PORT", "44818"))

OUTPUT_INSTANCE = 112
STATUS_INSTANCE = 100

PROGRAM = int(sys.argv[1]) if len(sys.argv) > 1 else 1

START_BYTE = 1
START_BIT = 7


def hx(data):
    return binascii.hexlify(data, b" ").decode()


def encap(command, session, payload=b"", context=b"STARTPR"):
    return struct.pack("<HHII8sI", command, len(payload), session, 0, context, 0) + payload


def register_session(sock):
    payload = struct.pack("<HH", 1, 0)
    sock.sendall(encap(0x0065, 0, payload))
    data = sock.recv(4096)

    if len(data) < 24:
        raise Exception("RegisterSession: za krotka odpowiedz")

    cmd, length, session, status = struct.unpack("<HHII", data[:12])

    if cmd != 0x0065 or status != 0 or session == 0:
        raise Exception(
            f"RegisterSession failed: cmd={hex(cmd)} status={hex(status)} session={hex(session)}"
        )

    return session


def send_rr_data(sock, session, cip):
    cpf = b""
    cpf += struct.pack("<I", 0)
    cpf += struct.pack("<H", 0)
    cpf += struct.pack("<H", 2)
    cpf += struct.pack("<HH", 0x0000, 0)
    cpf += struct.pack("<HH", 0x00B2, len(cip)) + cip

    sock.sendall(encap(0x006F, session, cpf))
    data = sock.recv(4096)

    if len(data) < 24:
        raise Exception("SendRRData: za krotka odpowiedz")

    cmd, length, sess, status = struct.unpack("<HHII", data[:12])

    if status != 0:
        raise Exception(f"Encapsulation error: status={hex(status)}")

    payload = data[24:24 + length]

    if len(payload) < 8:
        raise Exception("CPF response za krotki")

    item_count = struct.unpack("<H", payload[6:8])[0]
    offset = 8

    for _ in range(item_count):
        if offset + 4 > len(payload):
            break

        item_type, item_len = struct.unpack("<HH", payload[offset:offset + 4])
        offset += 4

        item_data = payload[offset:offset + item_len]
        offset += item_len

        if item_type == 0x00B2:
            return item_data

    raise Exception("Brak CIP response w SendRRData")


def cip_status(resp):
    if len(resp) < 4:
        raise Exception("CIP response za krotki")

    service = resp[0]
    status = resp[2]
    add_status_size = resp[3]
    data_offset = 4 + add_status_size * 2
    data = resp[data_offset:]

    return service, status, data


def get_assembly(sock, session, instance):
    path = bytes([
        0x20, 0x04,
        0x24, instance,
        0x30, 0x03
    ])

    cip = bytes([
        0x0E,
        len(path) // 2
    ]) + path

    resp = send_rr_data(sock, session, cip)
    service, status, data = cip_status(resp)

    if status != 0:
        raise Exception(
            f"GET Assembly {instance} failed: service={hex(service)} status={hex(status)} resp={hx(resp)}"
        )

    return data


def set_assembly(sock, session, instance, data_to_write):
    path = bytes([
        0x20, 0x04,
        0x24, instance,
        0x30, 0x03
    ])

    cip = bytes([
        0x10,
        len(path) // 2
    ]) + path + data_to_write

    resp = send_rr_data(sock, session, cip)
    service, status, data = cip_status(resp)

    if status != 0:
        raise Exception(
            f"SET Assembly {instance} failed: service={hex(service)} status={hex(status)} resp={hx(resp)}"
        )

    return service, status, resp


def show_status(sock, session, label):
    status = get_assembly(sock, session, STATUS_INSTANCE)

    current_program = status[4] if len(status) > 4 else None
    state_byte = status[3] if len(status) > 3 else None

    print(label)
    print("STATUS 100 first 16:", hx(status[:16]))
    print("Current Program byte 4:", current_program)
    print("State byte 3:", state_byte)
    print()


def build_program_bits(program):
    out = bytearray(8)

    # UWAGA:
    # Zostawiamy mapowanie jak w Twoim pierwotnym skrypcie:
    # argument 1 = P01, argument 2 = P02 itd.
    # Jeżeli tester wybierze zły program, zmień poniżej:
    # value = program
    # na:
    # value = program - 1
    value = program

    if value & 1:
        out[0] |= 1 << 1

    if value & 2:
        out[0] |= 1 << 2

    if value & 4:
        out[0] |= 1 << 3

    if value & 8:
        out[0] |= 1 << 4

    if value & 16:
        out[0] |= 1 << 5

    return out


def main():
    if PROGRAM < 1 or PROGRAM > 31:
        print("ERROR: Program musi byc w zakresie 1..31", file=sys.stderr)
        return 1

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(5)

    try:
        print(f"Connecting to LPC EIP {IP}:{PORT}")
        print("Program do uruchomienia: P" + str(PROGRAM).zfill(2))
        print()

        sock.connect((IP, PORT))
        session = register_session(sock)

        print("REGISTER SESSION OK:", hex(session))
        print()

        show_status(sock, session, "PRZED:")

        program_bits = build_program_bits(PROGRAM)

        print("1) Program Select ON:", hx(program_bits))
        set_assembly(sock, session, OUTPUT_INSTANCE, bytes(program_bits))
        time.sleep(0.5)

        show_status(sock, session, "PO PROGRAM SELECT:")

        start_bits = bytearray(program_bits)
        start_bits[START_BYTE] |= 1 << START_BIT

        print("2) START ON:", hx(start_bits))
        set_assembly(sock, session, OUTPUT_INSTANCE, bytes(start_bits))
        time.sleep(0.4)

        print("3) START OFF, Program Select nadal ON:", hx(program_bits))
        set_assembly(sock, session, OUTPUT_INSTANCE, bytes(program_bits))
        time.sleep(1.0)

        show_status(sock, session, "PO START:")

        zero = bytes(8)
        print("4) ZERO output:", hx(zero))
        set_assembly(sock, session, OUTPUT_INSTANCE, zero)
        time.sleep(0.5)

        show_status(sock, session, "PO ZERO:")

        print("OK: Program P" + str(PROGRAM).zfill(2) + " sent to LPC")
        return 0

    except Exception as exc:
        print("ERROR:", exc, file=sys.stderr)
        return 1

    finally:
        try:
            sock.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
