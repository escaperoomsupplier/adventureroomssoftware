# Lokalny panel operatora

Panel dostępny na serwerze aplikacji (domyślnie `http://127.0.0.1:4000`) pokazuje znane UUPC, ostatni kontakt, stan maszyny i zdarzenia RFID. Zasoby są dołączone do projektu: nie ma chmury, CDN ani zewnętrznych czcionek. Panel jest tylko do odczytu i nie wysyła poleceń do sprzętu.

Przyjmujemy jeden czytnik RFID na UUPC. Kontroler jest oznaczany jako nieaktywny po 25 sekundach bez aktualizacji. To informacja diagnostyczna, nie rozstrzygnięcie o awarii. Przy braku połączenia z serwerem ostatnie dane pozostają widoczne z ostrzeżeniem. Czas zdarzenia oznacza czas odbioru przez serwer, nie czas odczytu w urządzeniu.

## Symulator bez urządzeń

Uruchom lokalny serwer, a następnie w drugim terminalu:

```sh
npm run simulate
# Inny lokalny port:
node scripts/simulate-upc.js http://127.0.0.1:4100
```

Wymagany jest Node.js 24.11 lub nowszy. Symulator akceptuje wyłącznie loopback i wysyła cztery pełne pakiety firmware do `POST /`: bazowy `00000000_0`, przyłożenie `12AB34CD_1`, identyczny snapshot i zabranie `12AB34CD_0`. Identyfikator urządzenia to `SIMULATOR00001` (14 znaków). Oczekiwane są dwa nowe zdarzenia RFID; powtórzony snapshot nie jest nowym przyłożeniem. Symulator nie testuje UDP, nie wykrywa urządzeń i nie steruje sprzętem. Dane są sztuczne; nie używaj prawdziwych identyfikatorów opasek w przykładach zapisanych w Git.

## Podłączenie rzeczywistych UUPC

Włącz wykrywanie UDP zgodnie z konfiguracją serwera. Komputer i UUPC muszą mieć łączność w lokalnej sieci; zapora powinna dopuszczać TCP 4000 oraz UDP 9811 dla aplikacji w zaufanej sieci prywatnej. Nie przekierowuj tych portów z Internetu. Wiele interfejsów sieciowych i izolacja klientów Wi-Fi mogą ograniczać broadcast.

Nie uruchamiaj równolegle ERCC i tej aplikacji w tej samej sieci urządzeń. Firmware zapamiętuje adres pierwszego odebranego serwera ERCC do ponownego uruchomienia UUPC. Po zmianie serwera może być wymagany restart kontrolera; sam restart aplikacji nie zmieni zapamiętanego adresu.

HTTP jest transportem docelowym; UDP służy wykrywaniu. Snapshot zawiera ostatni RFID, a nie kompletny dziennik. Powtórzenia są filtrowane, ale szybkie zmiany między snapshotami, restart lub przerwa sieciowa mogą uniemożliwić odtworzenie wszystkich przyłożeń. Panel diagnostyczny nie jest jeszcze systemem rozliczania rund i punktacji.
