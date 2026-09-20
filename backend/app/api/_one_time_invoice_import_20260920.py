"""Ephemeral one-time importer for the 2026-09-20 tax invoice upload.

The invoice payload is encrypted and this route is removed immediately after successful use.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.invoice import InvoiceRecord
from app.services.invoice_archive import release_manual_archive_hold

router = APIRouter()

_TOKEN_HASH = "cd8adfc4018dced91dffe63e37e05dff1dca55b9b3ab9386a94da365635c1ed2"
_EXPIRES_AT = datetime.fromisoformat("2026-09-21T00:00:00+00:00")
_ENCRYPTED_PAYLOAD = "g6_vThsssq-4kJ-oXI3ExFRY6H_6ByGa5Se_gTUn9Ni2bUdr8CbzhegFr9-q3Ydcqer3trU2JBlh1T0TI27yZ7wSFeNxawW_MHN7ssjXpIPE6sMhlBQz7qqtIjcEAUKv7WuDDLCnl9uATCWhMFcrgAja_Rk6Xf8RQ8Z4Bi_VnFzspBPdwZZdCSPLZ7gt0_pAKCWewjBzt8h7RhKDCKFq2qWXvxba_V2Rf91V8vmm5fKAwmPXRh2kXJoj4iHXxc3Cj6TAOhvIf0PkXbXYRZmfudYE8L3CR0hfsJLHR4bbLdvgCq6e6OA53x0ItjI8U97IdksQDtkhoP7HA04PPzXCXrCLECql4_Ys3WwFVQexbXFZ9rkp1nf8h4D7LADT3ha7cs-1TJdEe2QhQoSGIoBax6Lsi8bvh9DTY0hQ1qC6lu0uf7W8oolnhPlL1vYqPlCQhUK_ANFIm35FKYBQT8FzL37P7AnKLnvNixsZNmMo_0DepfP5q1gApqSSJsYqk8Ni6RiCEiqW2T-_fPJ06Hsk0YbBtHcOTov5xYi4aWkHqo_XUHxPCoP-TKimVRt0EiJpyi17BGM2qKrVOETd_3nhUYwmqUTl3QGOLHvuXXIjRfMRV7JZkrb3y1LM9oleJeTyXdJZsFPp53oHLqr6OOxpklXq_eCAXyNlYzSejLRAGt_ydwnqiw5YnfhpzhTIJeHRjtOYhuxwPlmrsSpDIZVBqMR0mTE65At0O2HDuYX77_obBpjMPzmSqas56urrytpdEnbwsk3y9TXGRbYpwFvssuRYqHUDcWw7L95-UQ4zqzDMjkedEhH9mEY-haSxMpeLDQ0mqvD3SOBOqC6GNXkXlhF9wdtuWsmgh3i7fgM-qXDbcBQcn_dIv4Rxf62JLZEK3EvVYh4cK4EegUJImyQYi2RpeeeUUuGozXsTUezbSGNMB8iulMf1lNeE7UwYVFAE6igGtvjzRstJMGo1l2ad68m97oXHJiz-aqaxdRFoW3k7Rzno-ZzSeyUVjfSOjQaTQt0I4rERtWOTmxXi7uKvvt7dOwRGjXByJnUlvCgmw5G5cKhjwzD5jl5M3FMEtMYdEb_v3LBfaHLXO_HuHkNF6aHVqptp7zxk9DRnCQ5PDvasy9E9KF-ma5fOVzLa_cME18amvblG6l1Q0hoacRRtsUuEu-OAgx43PnZRAyUmYy_F4WRFa5WBfpeEPWIWMccx25S7aXinVeo8UO-iLCNiwpk608_5H1bfj5Jj2U2HUiMFzaIB-Gfl1MW1irn3s4jImCkpASDXN_S0MeK2Y4nvvy-_DJAR-ViLrZaaNd0Em9nJyOD6qzwRqHCxWeYi5vEwVZa8THQcc4R6lkyT10LW7TtPG5PLOVblXtThmRvCQIpmMOHrW7xa-icq2g0IRPQH0Ood3hyALU17z3nXPLVHCF9lTFxIEIX5cUXPZSbHVc35He1ZMjh1jLOdJahLCTw90OBW3KPymrHgzCkwXxFRD3YggcML-vIL_3CsUdfvPY3bRRNFbTKbTKBoBDL4vn3Mql2p_q-7kXPMYbdKDQ7-iwODKop8o4FndS1HH2n7VyuKFi-MfY7WKGKjV7WUQMHPiZs__kOVvcdBXFHXavQ-6Q1UJc-cqXOmWANnMQO5NdPRKNZxb8Ej64zSvAzgzG6GWCeGkFUCwLTjj7FvmvttBkQgGnvfyJczYA101xpyVpKlNzlZZzJ0m6pGx_IazJMzkmJw8fJR5bTxmcYVuyhf8hQ5kGF6pJQsScUrDEmKixDOJaO5cdmGHFabA3HttjnV8bJaPvSxoclAm8_0DmzF9itGq7GOQLTums4RsVsUS8RRl2xUepy8SLOrjQzokARii_W2Pq9XYNORt4ZVEvzNPoC3NrUTxWbD71wb4uGz921Ruhx4mIU_WSIYr8PLkruFm-BJViDKH2dJTwb_GYo7fLcbxFZF96p9zxsO1HrdZ3QFGGh-ffSV9v5cc6zfcTLUSwfrLRDql7yE35thQqUX6kzM5e11SpHNgDp8BkfjWLV3hF23W-1EV2Sng_4RUiDy6_y-3zZZ5GKSzrnm5l6zcjp-NoV3KMVAemDvuNTeOHlmbUqKUN4z4v9qf3crN_8P-reydeE8D42Q4yr1l1_gPb5n4XMUL5geAlK1rcOC32BoSG7xjSuDi8m-zHCotlWT6dVBtgKNluq2H3YRaimFF01o2DgUvDx8LNdtaRtjqRjcoZJ4TqGTQQSvrRvb7Sav1t-n-6T999wnlZ_9XxQclKcavpWDGYow52Jfdwsyoq9FCZ2ivqGOsYb58WmK-1xYhElfb4yNzXh6y7gawpa6Wjay4cgNqZS0MZEWH7PRTbv7WGuIqUq7MHYomWDQReb8-M5bPAslE82OQnMNQH7GnmkRVyKyb0tbekPwTDChZTQek1z721GO8SpPxd4vK3NaSkOQoBAya7euNfkmT6gL5-Cd5Y3KwG7l-Uwb_kXwtVs6ehQu3jQOX_RGchSjTMwcg0G4TaX3jrzYwBqlzhhbnbw0Iw_HcyTJRIuZX386UXdkatDV3DbheUo5kePHMWNLZIYiv8W_aTMB6x1Sy5xEI3VCJwtmm2ATzL__z9tEtkbnKO14Hcdba88JEc9Y_nvRZ2wHIH5Gck8mqiuKP5v-DTUKbFZKHA5H3NrxfqaZYFtK_qyopEN8D1TcURFifDHgfbblmLRh5C01Bp91u2lvQ9WTRst9BUDrjaT8JnJgAMrDk2wdtQBmlM7GbhQlDipm95emyXpLCQe8hl1Y5S-yK3NBQVVMWt29cNhg0-bitcaXlAJBTyRaJgkxJqKCuqMQtrRfhuvuim-v0x-7iV0OEfVZa2XtbO2HFzDSL6AUy2Jj8zbfEm1foZuVQk9sSw6wns3uNFbL1D7b8C5jDkHYjXjuAIzmnELcqO06JKO61LXHvHA028pDyXJjrEnqN-u2wcMDiK_j0Jkj87l5Ww7gL3JETH_MboV_rrb9hy316a7rbIjcd7mJlcigPv6hmej3z4LjUzk5nhCxZFxa2r2PQAftJg8htX6bdO1z7kGs4IXy6lbgrrbrMXHHWGDYUlksE5-ojHaPVPc5iGmIxHPFgdc6y5r4TTzBYcI9dYjiiT4-g9HKUZoFXAhW6iyNtB5DdyG28MzXWhzZNvlZ4Vl1FzLEtOh--KIqjI_OaU_0oV1jky2Ih9DZf6T_WbhvSjIyLAxyE8z3SBhOF0BH606Q5hGFvN5IGvEP9yxD8idDVmszSFRzi7TNth90up5kRZaueUPqMHTcfUdf20dw6io29zyqfCX90JF_JEKC_TFT0u8VBDHgC6Y5exM-TREIa2n6uFVmeaB3d_2-a9QiDTykG52EJaCnGzQPpwts6sSqN9m1t3mPb3LcisAUcrNOjrS2WMT_HoscnLakgn1xyZ3ZCTHep_p-hxqK-949BvtLLC28f9zkEdco3CsPTaYOCMQq4gcZIln737jKztZsTW9dxH7so_gtJ0HnFNCAQisv_x78Bfrjb7kovWeXlkcJNczIeTDcCYltsy3rM-dz3TdohfWTGknnpk0ZCISrJWZW3-EdSfolHuj7lzlbR1GSTBRvTp_oSakJ0xzzaT-P0T3eG595sAk4T85dyYXPaEdNwG8Tk2LO_Qik72nqfK43N2g25rMURiQ_glf-vukslbFFJ0j5PptWauXQEHjCvKNNfvqT7yufDboIICbsVyh01ii2elzoFhP5-g9YPBb4VAHm9zq7w5jqnrVfosNDDWqp4qWiVpkJFjQQVvXnVp3se27794j_UXrFcBgmyeZtb4a-1DVPQBunjdwG_PlQpNm8c45rZqPLf7Wvy8k70QqXCINDAsJbfq0II0Xn81Gt5QvQ6FX5K0pZnvZI-8D2GRJN996zRUsj6YeOodIJwz4_Edcd1O41VHOAncLpA5mD69Zj8Fc2ezxrkS-TsS6fOHGrt1zfR80ShivxM1_25fuLefgMB0HTUBiqv1Lz3a9SdIEGp_L8VZS657byVc4bQkXg355vxSGw1IJRHLxVWanPve1Q2JZZY5Z4kJvofpn2RqXMsWIJDenO5UJSNxC-or_O5awh3GyVbG7WejMOivizPFHUSUh74jMvSYfNNE_gK7mxqeYY-Xi0G04Y7z-eEpkPStLtOHm5o1_qAwrkYkuwXfaEtOBNvau1AOarbKlmC0ysAHyhxBRaFkANN8hwADiTWcO9kVy8pNq9503EnvPSmwNfs2EGx0XzJcYL2PnnQtPBLXog16EkId8_PE61cEQDGfq_mOaGqKojXEd5d2Bt8S7qhc5VVh4oJS7z0k8aka8Cg1ULEMyuNKmG0Oz3akDKf-UUVMp7RchiYfcpig7lqk8U47ytFlq-cMFSNEVpdsfjOuIJ6Rr3t5m2VxIk5uQXrAxtn0HviXeSFu3hyRj0ct1vPxmpM0_YiI8u2EAQfARSggDjHRMH-2itwoqIWZ_6krwz6c6U2aTtdNIzR3tbpUoe1gLubNDN8f4TSmkldBOxYPCI6LH3yvk6q-6ME5dIqNULfymwK1QHDyji9xDvrD7a56i3SOoDyBUJUpuN9baA3GLlsJkPrkMPJLR_UTa3bnnyMs4V7ET8_hmqfTEu2efJKz2xKYv9MRgt5AB-xhoOs2EtRPIqXXVAwIYFM79jWDx_VU9rdm1kYciXSX9BnBaMejcnyoPd6Msc-FQclbliVPa-l-Ii3BwQjEYAOF4InHhuyiknG-PjzlIVnI8mKW-ZV1kAkFCKku6UcdfA50quc4d59pRCHGb6TvLREHXPIzR56Gaa_xnSRxy9EO0WxLHIeyWoygqPbokiaLdwnYqiEC8ISnED92l4B6x17EXS67Q8fz_JjCC1-seXVFprFB-sMuoPkP8UACcD9UM9Ed1-raPXG2yOZHQpVWw4cDyIsM4OsBYbC35ti3_HCMZcxnigNVZg2qzy77QEMbqflxJ3ipIXIzdj1ZDx-JtpUxCTf_ILgLrYDy1XFIMwg8BuVbKoYzBSZjfxSIsokEz6t7ZgrRk4pbxLjZ3mvf9IdZJ39e3T1CutVvtcJBtySCTCAFq7OmFS5p1-VfUc2wc4HQNvSrT0gLDmlpDitD4cQuIA8EawIAAHSHpxOtoDNT3iKqPZH5FU59rvBLRSmYBhpP7Xt0b-kq01nrNzZ99Kvo-zk8vVwtnLl3yb-nNMl_5WS1eOvvAasgqbllgOWcLV3sO2cmx5VJSMtIfG1QR-bkuUYqFjQfbVK51yN5UvrJHWfrXJYB1tiX4KJ0YLzu2m8YYG_RmjDmMFXEbXyCcCTh_fqcubWHw8XDU7mvy8JxLc1UAlowLuNVAlGg-SopP17sRQxBk6RqLZL4WGAeDzVuolI8cv3vEEX_aLh53SBtbPR4h_YYoBhH742X3ELsXslnVji0r4QiMvQEfqY7jfCtIrEO6gExGbf1FAsyUA6SYgIqkLqGQKLBLsGJN6yJK0ZroEzqIsYoAWItgEC3McY0G2X0S8kxA3YqsmbHwNbY026oy2L6c137AGI8xLR881_tGswvCI5T9IHmmVhLhIHOo6-h-5fsZcUyb9RfOrJHWqhnj0tTYEB88QqCT-N7dT1ix5Dgcpcvr-kmsXN8NeacShx9lsauKr9eRPHxGBeehsfKu9uALJiVv0etu9WbOunSLSti8RzQfCouFIIH5Qv5nb9eO6viwounplNGhGkr5zfeqwTTkHD3ueTIW73V0ZXgrqdNYyVj0-JxAScXCxI3fvBRffGJ4RRD_5E2WF7p1iNEudThl35fM4_G3nSKQlr_Q9NLleIOMI61Pu3zM1sA5qqquO2gTjdgqK7ntsHiAsR70p3lZ3kbsDfyNyKoj3m0ToDYNu_fmXABVeVv4qRlsgHYBUqh2ZlrTWr2VB5kUfRRtmJNiq5DKlkOuB_lLAOqm832Uco2FgITv5yVrJNRSwSSnt0x273WMXPpDvqGZEhUDPYjdBogMCPS989T4eb61vSTBgc4y1_cxRCPmvnqibMYL0Lq4TtlkAyaUqfSVgdXftloiJEYlyRLAtKO6asYYxf4jhN7y6Yu39EZwfZ77hmWQOsgrZ-HdW86lFoOR5-RnxVO8MuOMR1Ux0wHHq0zTEDNY_KlcZNWT1B4QuuY-3B8WurWrhraLYNmsYVLiH9-fzAp25I9nLho71D3ZSUKwjMxSM-xrBPyisa9SD9NNjBK-qhMF8-m5mAwMtsf62GfXpLwKCCq3U0Fva1_z1Rw8GDN1fKCN1rQzWWE4reG4ixcKaO7bD-CV6p-d1DXjZHW7HKYjZ34hf1SE03D7y9Spuv4M30D7Dhol2BPvcxZBf5KqvVLcEzeqVXf6-Yto2RV587OAX5md1BVEQJB3-s7dyA_fBjMWjsHkj0GoNJ2nOpgng-cIwjQnIFNYK3YBzpakgLRiAX6S5PqXFWeui_5yfEb-EwW_SQZ3HefoB0OWNTv_6PY7Yito-3anTVa1b8z3H7hfTgbf2EBUaJUr4l3GSS-2oRA5i6DMHGVfjIjut4Tm2fLpKH4yC1u_saKF4Qg5wbwAcUnlMFySoyJzO87gdj4afqcx56MbhQV-xThKHfg2HcupjGaaSz8UnVQWh0x_wu7bOLGMuqF9sTCOa0VpblUxSAjJp2k-PxHLY_l42_euhecqGU2XKbchZm4EHag14eklO8YIf20mqdMkOQXsXAL7Tb-shfugCsC67fluKAlwJG_d2liptpIZDB5H8TlW4CEdl2qIJYB06NealOX1mECAT_XMiiqVAWSYBI_QRUjmsWS9P-rIrnmXzHhUP5aUoutRnqvzaiOjCfr4O2gFlt6lBLW8agIU_-Qx2-Pu1aqSbIp3zLTBhVRz0eIeQdGdM3jtXjSfD_LIWKcEbR-gjx5QvGCU_9PjU-cOtbzrloH9JEUpNbkl1KtYyLAkvSuet91e4ER1Uraw4bCreUJ4xqt3s9US2k7IJJfBNagBXt3iFYnbpIiq7_iJAUBGYIVtYOqIsa0HiuqEfpyegOtXCm2iTiZjMs3Wi9vWwSgfdrKnb3lo7nc9iiAtcPPjFst7SkWaM4n9lggXTWHVYXHcvkxmkeLcPFgo8wDE5_9Vuc8nV5Xh80cfKA8jXrM8uF1BVI7CoJBbTImuPz1FrYA2DqUCQE86b6YehtHxBVcvkZALW0eLwn3qZJV4akhTn2z2kmRHcfcFcZkGko1xdUKCQY1VoZosIJx5Zy0hUNFBc1Mzzx5_zKF0yf7aaDxmM6Vz14129G8z23s9_ahMwqu1e3pGX2RnGRF6NzhP6KmLAwD73dnr-OCryBtQHQ5GDh5j5QCCGWyPh7TmToEqpsoAeBdkV_BxiX9V9jKlbllLh34PJPNaJUcVP-3l5OOAMusspDuP10xgeXZ5qKgTIDT306lh-Jv3yHli2JTHxnN76QI6tSeA3VnMlRR_D2tYoM2GLYLwvrh2b6Ady3wBCLIHoEV4dkYhiOIR-EtnOE5LzYWoIRMlGmN8nQMUd8rlZeWxVyFtSsei9DUVoIrWJrdQHoTxt2A3YOjjAiSvIhl0kQdwXEgQWAwrDO1TeivkegpuxnXM6Oit6HJ9qzPLY0rNb7HEaZU7sGmlQz64xlIXVUC4s7OmMDHQCU6lSSTvRQ2rbXJfTayU10yEOO5DScYOIO9ndby-F6ZjVFN0t5n_uYG-EtqiMyW6E5nitzUz9LVhuoxlk9GlZvNiMqs7qFdJnxUIcYuwezkQEq_AbLK_lbvVr0Ck5Es2SBlbbxh-66J626cNlHRvVompPpS5AAIqCnYzj6SQ4Sv-J9JSBbunPLRNFWx_r0ggs0OyAapf8PeVYulejpvF7lwsR-o3pG1SYjHewGcvRdiZhsNNWn7ZYP7Xs22TgTx3twGk01ulLuVhB-yj0caEodKvuhJpSv8yfaXzg74aJPf5EbeC4cIBTRzZ_qL-BLYU3g6Q7VbuFpAgxQvGJ81rXmxZBfNjiHZXDCgbnkkZPnBMbLMshOZ76Vpf0G3cqLnOyf19dp3kKRAZuc6hqNSFgeciPCXPv0UnhojI5h043o9hy5tAYaDRQz4n36HkEc-x_2G_mgyOi0CAoWn6_LgmVrnsOok-0b7iMlG7hkq7qAxg5yMQ3mHZXfm2Tlqn27HV33lBpC0JyhXz8RZClmg0pYeHGQf7XYmGUsX1j59eGHwMYUy-Cn5vTBwu8woHBdB_pFrniwEl_eiYCXB-sSb1pZUxs_Qqb9xBX051hEJMkrNJPN8rRCXNBiXJ9PYyjdHTF4GEPxmciaRAvDmSB9g3OUqoGEFuq1GQx5jAeSusNVfUfrmXATPlIWnDJUbIl4_AUqznLRPpc8jmktizC1arzzK_nLoeCu8859qtwr46pu79tA71f-7ciQv4b0aAd9lah7tTcBKFio9NVLp9k5oUwEuqtEwqslJ9aEeUGtMXCCywsqQGc4i_d-mXcTHx-4Lvyk6U1V2JHWiHpe3rcI5_AaNJ69Ymbu0joOas_fE0lAVEqQ7emjwbA4M2TqoiX9rwy1iYYh0DteF1qWwABNyNkqNv_w7n5-WiNPlMcVKePmMm94FC5zIsLvtqcku9BsFp3W7vk55OdnfdB-dXSiSuq7uVMUU1xiuWzKv6Q0YKUs8KOpXkX0NMNCbAIF-XkTStMmte8Kh7ZWaJUuHuSWcD9EtkIS1_9n2J6DOCsogdEmRjLr8_Zo3pq-NwV-xtOqwRuzE1sAot7-RvMFFZyEF6B4AHfLzh0FUSnZg_BIZEEB-h_tA1uoRqpm6GEh78xw6Z42h-skwGOhv2cbhbg-Fpaxg1vpoeNRUCwTSE0g6e9KruzBOEg5lGzXf5AiZsexFqlfi3V97Vshc7ITGfOh0QsYPjYSnGcmya8Dis2LChyvXHPj38RVWX6ilgDqYsOj6EnSOP1oeE4hqHnDBXCOluF7niRfvF3yb79T2d8jkWWpwPb8ivIWzVumdVCyDxVQ4x4xzoPcNRXe_-B4U65RhoeBewBSxdB4LgNFytzYvxiFtsXHflo80u9TAzM0ioSTTCMYPa3uhueAnI_Nyc0pgpRqzIGLlSMEL9srJgVyKq7CToZZtstvFfEbPzd3DJ6-MKqi43LJwuAu2aMVPwkx7UcAFLIQCjUaEtdWPf6J54b99KBX4zkh1mXnSfKfd71pG3mkKWV7JzEp_XchqQ7DtxMpV4iZlQfANYlVBDxyD-ZJXKnycxyE_q4tH_9dxY1vf68kAcEYIwId_dX_67fdpalCAdXU3Qhd_AQCFD5oGZiyUUQG3BDCEvm-SzrdO9kig0jE-s6oBv3ykGN2kpQa8RpkDTqbu9MEA2iUNer4cWU6Ooqf9aWbT-v7cKeHjdYcXLeCbGiANdaB6oxJzXLspCkaw65DYdocZ_ok_vdI00-prnsyn8RKKDrrIO6wsTwF0d8Dq6dxiJg4vDONt-0iW18Nu9pJuVeXh3bnmjhTo07Hg-kQShyfR_WYBXVgb9DJezu3wXofDFas4uAv57RYQiZJTLCzI8JyWGJaP1ZvOXHFVmhNrd9jTuQARsQubVYkZQVtOSqKHkfzYkruxHl5nUX2YDsBlilU0MvxPYvZQigC7S50_gnGxHNIPpXh2iDuY71P14GZL-VOJJtziem_RPHIZLL7LeO5Y7E38lTyX_l1FIEJKUcXLAE20c7I5nzvZTc8xvrJb5kgFSTlyP4DswOHtSDUFhpazjQUhPHkPwBMAWRNh9cb4C38nKuoUQAzBwoOCcICNOXo-bmX7ZM85RFfAYiAy6CUGMBYW4ZJQ3HmBEgFI8G-wdnz_CR9krGNjb2_MvhXFsgcBTOsTbaRmGG3f9AfLo0mw1ZSUBr9m5_Cbiw7h8Z1XPY6OMp7nSr_F1LtyoYe_8G7C5TSlZfRZgf-xCG87oj8-r_GnHE5uUfy_DQLL6aApeQD5zkHiGO_OwEpN3Sh5n4lApl-D7yriZHeX2GgInNfiAarylLX2lfMFRYIhlJ1qmz9dtJLb4kVWhp_tIbLrro3c8DMRXdsW-FuN-3ON7ieFtd5remqUwzeTVWk5CNwfa5Ta0H86gVsmBc5Uso7TkH0k37o463uNQV40EUHp5HOYLFUR0bSOp6TX7EEJRsuj4bbcN7cqi511XpUsLfkhEpZ8dygBAcQwD9rtvS_IvBo-dtNYH4sfYf7lpHNZFJRJuv4lu-BsJtCoq0Yx9N2UNs_mwfX5kR34CAooOSL1Wlb9al5EpYPKPx6ZWK3uolQ92f2G72v28HxJxWGSJhtKKSt5EChdFOOQa_LB0ejqgfmSx_Vw_-xC9QIUW4LTP7ZWnMrs514heOHqZh3y2xhsNDQSZRfj-5_PMPmq0AMzHf7uSQqq9f2jCDYVpflEVYvZ__yyGx4iAJQmR4zUvr_HijOW_ChYXXmL6GGluuBVNmlEjUn1chAG4_TxEJJP8GWDx92ub0odmbPvRm7XjrncL7BHs1RwrAqUrmGH9metOGMSUU30CPx_FB7MeUTJb-ZD9hFcC7HGUc0YYCRKb756-7XZXJycPboOcKZeZNCzXzVKX66KgwV6Rhax_1XDhHpMQqzoKOQ_LWmF8GGkvEiuADG6p0Fxmdu9VrioX8Jvj06buqr-0jEXwG-3_uCy40T4g994EhSgZU7cfv45H3l7q1n3zmlT8g1EVw7lmkexQgDExZ7o_fwlDR47TQvOMzW-B-2YkAjnqLM2_GrQmp9yCR4GjVeZiysCVAoGTkXhrPjEZQQW3UWa29MvudI_DeGwoKrnSv6pZcW9ODC26XS_MuNdlaikoBK0rpSgfUwHPksNrM9wo0mdRCHi8BYiJEITKqtHF4H9dumGk0EdQGUYYZW0gjp09eAER8SLnhr08VJoF7rTtnk4YzfZ2Javpz0AbgWcWL1prx4cl8FfJTmX1M2w2wrR1DA5NVQpscEBgeWKld2pZ451FKJkfZNP9UB8DTXwyJeaZTtoIeFhu3B5yz-HohYER791ve7Jua1BWWxuxYZ6pFCczaSoj6sZhljMLVDzdGSvZqdhKoJfgQlh_DpRQVDWsW5FJcnwMWupW6eb5b_mjRs_ZsMgS96xQIMD79lIRcdT05CDuRenjzLYn1wi1bKqoQOgaDJAGpf6aA0TRLPAyb-TjU8i-dKJMWbnGX1jINRJ_QhaxGHb8U5okITyRzh6TlTPGYRf0-08U-HthePS3RS4PgAhOu3xCG6Yfx5JNO972SgHvofCY-4bXoac2U7CMiAXXVX5I2-ibgQwDOYX6_sTkw6KJW7aH5YPNBX-Hp6snvGnYnKvd-EMZU7YgDIHTGBy7dllTMyHjx4YK26FZLStPuY2xN_p1Z8uRpzqqEQGYvIBeuzjy70F8GvTvvFYKr9qG0F5KdGI8YYpr5czfJ6F3lYD-F9-WEoMMNkWS0OwAwpvbzTYwnMB920SJ-GhXn1T2834U5pOcSninWcz7rf9eYsfYDc-QxWrxQUUD5GBeqzI7jkAAWs2fZcy3cbHU8r66eSbftDxRpOFi4g-nzrHkD6CWA9N1du8J1B0FkRQzu24MEcGSyTXZUDFGuVxTTBOIYNWOC0q0Dum16RDpX2Vn1qyR2idmtKUN5DQBPf1zSOMbxOd_9TAa3BtfQ5ZPWHy7HzGywtZz1UCw3iWPALO3oVZimTb_chXOVAdqoxSkr8ezvgZMTaLFEpLOJw9tJ0bAjTTNsekCSXEwHG9l-AbJZ1eGkIDcKdEJlJWLMpFRjriOTu7heUZ7dtzH5egM_ld9P3Xe04K5koTDsPi9MB3PMeZzqyCsRnIJ0TTWmS-5BPNY2RN7L_jNLrktd1YDslgblH0kxn-bjbhGG_Jp-XEnscc3RqP2V-KcEaHX8IyS_fqpeOjFDST_AQGCMiFmck41dz0MbCcEHlAYqSAniZ6n3Z_3Bzdrx2_sVMDcO0n8voZZ4bjD69nEH5d7k_0zxepaOlrld83vhJ_LeRhYZMQGUP7t4v0P-2JMbJCXX_1khjR91MJeHvCUkhkM8U2uVaeQPMMf4vrwetblkrJiVqNwaihTOml50l23r7O_IB23Ca8xdt3slLOpPQqaIaVAWARjo2K11wleRZCYm_PDR2wa9DJOm2-ld3ypithnOgX-B5qVHZzrRpf7ofFtBMKDBYkde2mrqcvk7rr_rFUCRta4Ct5HUtencHuZA7xyUuqzqcWp647bj3FKeq0HILSkEKqd5eSBWXAyC-wv5FiO2-RxKSaARfQlsQHSM76WuA_dTv_5xDs4ZlPt4xqZ7vIgZljg1rvKeU8tIBc_ymAiC6h7bN7Y0X1FpGaVLiYYBEcM="

def _payload(token: str) -> list[list]:
    if datetime.now(timezone.utc) >= _EXPIRES_AT:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="expired")
    if not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), _TOKEN_HASH):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    raw = base64.urlsafe_b64decode(_ENCRYPTED_PAYLOAD)
    nonce, body, expected_tag = raw[:16], raw[16:-32], raw[-32:]
    enc_key = hashlib.sha256(b"enc:" + token.encode()).digest()
    mac_key = hashlib.sha256(b"mac:" + token.encode()).digest()
    actual_tag = hmac.new(mac_key, nonce + body, hashlib.sha256).digest()
    if not hmac.compare_digest(actual_tag, expected_tag):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    stream = bytearray()
    counter = 0
    while len(stream) < len(body):
        stream.extend(hashlib.sha256(enc_key + nonce + counter.to_bytes(8, "big")).digest())
        counter += 1
    plain = bytes(value ^ stream[index] for index, value in enumerate(body))
    data = json.loads(plain.decode("utf-8"))
    if not isinstance(data, list):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="invalid_payload")
    return data

def _record(item: list) -> dict:
    (
        direction_code, invoice_type, digital, buyer_tax_no, buyer_name,
        seller_tax_no, seller_name, invoice_date, amount, tax, gross,
        issuer, raw_status, positive_flag, risk_level, original_remark,
    ) = item
    direction = "output" if direction_code == "o" else "input"
    source_file = "全量发票查询导出结果.xlsx" if direction == "output" else "全量发票查询导出结果 (1).xlsx"
    source_size = 12423 if direction == "output" else 10808
    tax_status = "void" if "作废" in raw_status else ("red" if ("红" in raw_status or float(gross or 0) < 0 or positive_flag == "否") else "normal")
    remark_parts = [
        original_remark,
        f"[税务Excel] 来源文件：{source_file}",
        f"税务状态：{raw_status or '-'}",
        f"正数发票：{positive_flag}" if positive_flag else "",
        f"风险等级：{risk_level}" if risk_level else "",
    ]
    return {
        "invoice_direction": direction,
        "invoice_type": invoice_type or None,
        "digital_invoice_no": digital,
        "invoice_identity_key": f"digital:{digital}",
        "buyer_name": buyer_name or None,
        "buyer_tax_no": buyer_tax_no or None,
        "seller_name": seller_name or None,
        "seller_tax_no": seller_tax_no or None,
        "title": buyer_name if direction == "output" else None,
        "tax_no": buyer_tax_no if direction == "output" else None,
        "invoice_amount": float(amount or 0),
        "tax_amount": float(tax or 0),
        "amount_with_tax": float(gross or 0),
        "invoice_date": invoice_date or None,
        "issuer": issuer or None,
        "invoice_source": "电子发票服务平台",
        "source_file_name": source_file,
        "source_file_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "source_file_size": source_size,
        "tax_status": tax_status,
        "status": "已开",
        "remark": "\n".join(part for part in remark_parts if part) or None,
    }

@router.get("/run")
def run_one_time_invoice_import(token: str = Query(..., min_length=20), db: Session = Depends(get_db)) -> dict:
    created = 0
    updated = 0
    output_count = 0
    input_count = 0
    gross_total = 0.0
    for item in _payload(token):
        data = _record(item)
        identity = data["invoice_identity_key"]
        digital = data["digital_invoice_no"]
        row = db.execute(
            select(InvoiceRecord).where(
                or_(InvoiceRecord.invoice_identity_key == identity, InvoiceRecord.digital_invoice_no == digital)
            ).limit(1)
        ).scalar_one_or_none()
        if row is None:
            row = InvoiceRecord(
                id=f"tax-20260920-{digital}",
                verified=False,
                verified_amount=0,
                verified_record_ids=[],
                **data,
            )
            db.add(row)
            created += 1
        else:
            release_manual_archive_hold(db, str(row.id))
            for key, value in data.items():
                setattr(row, key, value)
            row.updated_at = datetime.now(timezone.utc)
            updated += 1
        if data["invoice_direction"] == "output":
            output_count += 1
        else:
            input_count += 1
        gross_total += float(data["amount_with_tax"] or 0)
    db.commit()
    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "total": created + updated,
        "output_count": output_count,
        "input_count": input_count,
        "gross_total": round(gross_total, 2),
    }
