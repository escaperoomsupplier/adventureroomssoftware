# Adventure Rooms — lokalna integracja UUPC

Pierwszy działający fundament: wykrywanie UUPC jak w ERCC, odbiór HTTP POST,
lokalna baza SQLite i panel diagnostyczny. Docelowym transportem pozostaje HTTP.
Nie używa MQTT, chmury ani zewnętrznych zasobów podczas pracy. Zakładamy jeden
czytnik RFID na UUPC. Ten etap nie zawiera jeszcze drużyn, punktacji, sterowania
zamkami ani instalatora Electron.

## Uruchomienie na Windows / macOS

Wymagany Node.js 24.11 lub nowszy. Brak pakietów do instalowania.

```sh
npm start
```

Panel: http://localhost:4000. Baza: `data/adventure-rooms.sqlite` (ignorowana przez Git).
Proces serwera działa niezależnie od okna przeglądarki, ale musi pozostać uruchomiony.
Zatrzymanie: Ctrl+C. Kopię bazy wraz z potrzebnymi plikami WAL wykonuj po poprawnym
zatrzymaniu procesu; nie kopiuj samego pliku aktywnej bazy.

**Próba bez sprzętu i bez broadcastu do sieci:**

PowerShell:
```powershell
$env:DISCOVERY='0'
$env:HOST='127.0.0.1'
npm start
```

macOS:
```sh
DISCOVERY=0 HOST=127.0.0.1 npm start
```

W drugim terminalu: `npm run simulate`. Testy: `npm test` (wyłącznie loopback i
tymczasowe bazy). CI uruchamia je na Windows, macOS i Linux.

## Sieć obiektu

- Domyślnie HTTP nasłuchuje na `0.0.0.0:4000`, UDP na `0.0.0.0:9811`.
- W zaporze dopuść TCP 4000 oraz UDP 9811 tylko w sieci obiektu.
- Co 5 sekund wysyłamy `Hello_from_ERCC\0` na UDP 9811, broadcast `255.255.255.255`.
- UUPC odpowiada `UNIVERSAL_` + 14 znaków ID. Heartbeat firmware powtarza się co 8 sekund.
- UUPC wysyła pełny stan przez `POST / HTTP/1.0` na port 4000 adresu nadawcy hello.
- ACK `200 OK` następuje dopiero po zapisie transakcji SQLite.
- Panel jest na razie diagnostyczny, bez logowania, przeznaczony do zaufanej sieci LAN.

Zmienne: `HOST`, `PORT`, `DATA_DIR`, `DISCOVERY=0`, `DISCOVERY_BIND` (IPv4 interfejsu),
`DISCOVERY_TARGETS` (adresy IPv4 rozdzielone przecinkami, broadcast podsieci lub IP
kontrolerów). Przy wielu kartach sieciowych wybierz interfejs i broadcast sieci
pokojów. Dla rzeczywistych UUPC zachowaj HTTP 4000 i UDP 9811 — port docelowy jest
zapisany w firmware. Broadcast nie przechodzi zwykle między podsieciami.

Nie uruchamiaj równocześnie innego ERCC w tej samej sieci. Analizowane firmware
zapamiętuje **pierwszy** adres ERCC i nie podmienia go po kolejnych hello. Po zmianie
komputera, adresu IP lub odbiorcy może być potrzebny restart UUPC. Zalecany stały
adres komputera lub rezerwacja DHCP.

## Semantyka RFID i ograniczenia

`message.RFID` to ostatni stan `AABBCCDD_1` / `AABBCCDD_0`, a nie identyfikator nowego
zdarzenia. Kolejne POST-y innych stanów powtarzają tę wartość. Porównujemy ją z
poprzednią zapisaną wartością per UUPC, również po restarcie serwera. UID przechowujemy
jako tekst (z zerami z przodu). Stan `00000000_0` to początkowy sentinel firmware.

Pierwsza nieznana wartość jest bazą porównania, bez emitowania zdarzenia. To zapobiega
uznaniu starej przyłożonej karty za nowe wejście, ale pierwszy rzeczywisty odczyt może
zostać pominięty. Po uruchomieniu sprawdź połączenie i wykonaj próbne przyłożenie oraz
zabranie karty przed użyciem operacyjnym. Panel pokazuje również ostatni stan karty.

Firmware nie przesyła numeru zdarzenia, boot ID ani czasu odczytu w POST. Zapisany
czas to czas odbioru przez komputer. Utraconych przejść lub zamienionej kolejności
nie da się jednoznacznie odtworzyć z samego ostatniego stanu; to nie jest gwarancja
exactly-once. HTTP firmware ma ograniczoną kolejkę i nie zapewnia trwałego odtwarzania.
Historia `/rfid/history` nie jest jeszcze używana. Nie naliczamy na tej podstawie
punktów ani nie otwieramy drzwi w tym etapie.

Obecny firmware przekazuje 4 bajty UID i nie podaje portu czytnika. Roster ekspanderów
`{id,full,sensors}` jest potwierdzany, ale nie przetwarzany jako stan głównego UUPC.

Następny etap: przypisywanie UUPC do pokoi, sesje drużyn i obsługa opasek; przed
sterowaniem grą test fizycznego UUPC i ustalenie potwierdzania startu/wyniku rundy.
