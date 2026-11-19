"""메일 보내기 (비밀번호 찾기 코드 등). 서버 환경 변수로 정한다.

  PDFSUMMARY_SMTP_HOST       메일 서버 (예: smtp.gmail.com). 없으면 메일 기능 꺼짐
  PDFSUMMARY_SMTP_PORT       포트 (기본 587, 465면 SSL)
  PDFSUMMARY_SMTP_SECURITY   starttls(기본) | ssl | none
  PDFSUMMARY_SMTP_USER       로그인 아이디 (없으면 로그인 안 함)
  PDFSUMMARY_SMTP_PASSWORD   로그인 비밀번호 (Gmail은 '앱 비밀번호')
  PDFSUMMARY_SMTP_FROM       보내는 사람 (기본: SMTP_USER)

  PDFSUMMARY_MAIL_DIR        시험용: 보내는 대신 이 폴더에 .eml 파일로 남김
"""

from __future__ import annotations

import os
import smtplib
import ssl
import time
import uuid
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Optional


class MailError(RuntimeError):
    pass


class Mailer:
    def __init__(self, host: str = "", port: int = 0, security: str = "", user: str = "", password: str = "",
                 sender: str = "", outdir: Optional[Path] = None, timeout: float = 20):
        self.host = host
        self.security = (security or ("ssl" if port == 465 else "starttls")).lower()
        self.port = port or (465 if self.security == "ssl" else 25 if self.security == "none" else 587)
        self.user = user
        self.password = password
        self.sender = sender or user
        self.outdir = outdir
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "Mailer":
        e = os.environ.get
        port = e("PDFSUMMARY_SMTP_PORT") or "0"
        return cls(host=e("PDFSUMMARY_SMTP_HOST", ""), port=int(port) if port.isdigit() else 0,
                   security=e("PDFSUMMARY_SMTP_SECURITY", ""), user=e("PDFSUMMARY_SMTP_USER", ""),
                   password=e("PDFSUMMARY_SMTP_PASSWORD", ""), sender=e("PDFSUMMARY_SMTP_FROM", ""),
                   outdir=Path(e("PDFSUMMARY_MAIL_DIR")) if e("PDFSUMMARY_MAIL_DIR") else None)

    @property
    def enabled(self) -> bool:
        return bool(self.outdir) or bool(self.host and self.sender)

    def message(self, to: str, subject: str, text: str) -> EmailMessage:
        m = EmailMessage()
        m["From"] = self.sender or "pdfsummary@localhost"
        m["To"] = to
        m["Subject"] = subject
        m["Date"] = formatdate(localtime=True)
        m["Message-ID"] = make_msgid(domain=(self.sender.split("@")[-1] if "@" in self.sender else "localhost"))
        m.set_content(text)
        return m

    def send(self, to: str, subject: str, text: str) -> None:
        if not self.enabled:
            raise MailError("메일 서버가 설정되지 않았습니다.")
        m = self.message(to, subject, text)
        if self.outdir:
            self.outdir.mkdir(parents=True, exist_ok=True)
            name = f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 10**9:09d}-{uuid.uuid4().hex[:6]}.eml"
            tmp = self.outdir / (name + ".part")
            tmp.write_bytes(bytes(m))
            tmp.replace(self.outdir / name)
            return
        ctx = ssl.create_default_context()
        try:
            if self.security == "ssl":
                s = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=ctx)
            else:
                s = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
            with s:
                s.ehlo()
                if self.security == "starttls":
                    s.starttls(context=ctx)
                    s.ehlo()
                if self.user:
                    s.login(self.user, self.password)
                s.send_message(m)
        except (OSError, smtplib.SMTPException) as e:
            raise MailError(f"메일을 보내지 못했습니다: {type(e).__name__}") from e
