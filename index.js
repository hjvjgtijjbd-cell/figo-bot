import os
import sqlite3
import logging
import aiohttp

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    KeyboardButton,
)

# =========================================================
# CONFIG
# =========================================================

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

# WhatsApp Cloud API
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")

DB_FILE = "figo.db"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

logger = logging.getLogger("FIGO")

bot = Bot(BOT_TOKEN)
dp = Dispatcher()

# =========================================================
# DATABASE
# =========================================================

db = sqlite3.connect(DB_FILE, check_same_thread=False)
db.execute("""
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    phone TEXT,
    connected INTEGER DEFAULT 0
)
""")
db.commit()


def save_phone(telegram_id: int, phone: str):
    db.execute("""
    INSERT INTO users (telegram_id, phone, connected)
    VALUES (?, ?, 1)
    ON CONFLICT(telegram_id)
    DO UPDATE SET phone = excluded.phone,
                  connected = 1
    """, (telegram_id, phone))

    db.commit()


def disconnect_user(telegram_id: int):
    db.execute(
        "UPDATE users SET phone = NULL, connected = 0 "
        "WHERE telegram_id = ?",
        (telegram_id,)
    )
    db.commit()


def get_user(telegram_id: int):
    return db.execute(
        "SELECT phone, connected FROM users WHERE telegram_id = ?",
        (telegram_id,)
    ).fetchone()


# =========================================================
# KEYBOARDS
# =========================================================

def main_keyboard():
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🔗 ربط WhatsApp",
                    callback_data="connect"
                )
            ],
            [
                InlineKeyboardButton(
                    text="🔓 فك الربط",
                    callback_data="disconnect"
                )
            ],
            [
                InlineKeyboardButton(
                    text="ℹ️ الحالة",
                    callback_data="status"
                )
            ]
        ]
    )


def phone_keyboard():
    return ReplyKeyboardMarkup(
        keyboard=[
            [
                KeyboardButton(
                    text="📱 مشاركة رقم الهاتف",
                    request_contact=True
                )
            ]
        ],
        resize_keyboard=True,
        one_time_keyboard=True
    )


# =========================================================
# START
# =========================================================

@dp.message(CommandStart())
async def start(message: Message):

    text = (
        "🤖 أهلاً بك في FIGO\n\n"
        "يمكنك اختيار ربط WhatsApp أو فك الربط في أي وقت.\n\n"
        "🔐 الخصوصية:\n"
        "لا ترسل لي كلمة السر أو رموز تسجيل الدخول."
    )

    await message.answer(
        text,
        reply_markup=main_keyboard()
    )


# =========================================================
# CONNECT BUTTON
# =========================================================

@dp.callback_query(F.data == "connect")
async def connect_callback(callback):

    await callback.answer()

    await callback.message.answer(
        "📱 إذا كنت تريد الربط، شارك رقم WhatsApp "
        "الخاص بك باستعمال الزر التالي.\n\n"
        "الاختيار بيدك ويمكنك فك الربط في أي وقت.",
        reply_markup=phone_keyboard()
    )


# =========================================================
# PHONE RECEIVED
# =========================================================

@dp.message(F.contact)
async def phone_received(message: Message):

    contact = message.contact

    # Only accept the user's own Telegram contact
    if contact.user_id != message.from_user.id:
        await message.answer(
            "⚠️ خاصك تشارك رقم الهاتف ديالك أنت."
        )
        return

    phone = contact.phone_number

    save_phone(
        message.from_user.id,
        phone
    )

    logger.info(
        "WhatsApp connection requested | telegram_id=%s",
        message.from_user.id
    )

    await message.answer(
        "✅ تم تسجيل رقم الهاتف.\n\n"
        "المرحلة التالية خاصها WhatsApp Business "
        "Cloud API الرسمي لإتمام الربط.\n\n"
        "⚠️ هذا البوت لا يطلب منك كود تسجيل الدخول.",
        reply_markup=main_keyboard()
    )


# =========================================================
# DISCONNECT
# =========================================================

@dp.callback_query(F.data == "disconnect")
async def disconnect_callback(callback):

    user_id = callback.from_user.id

    disconnect_user(user_id)

    await callback.answer(
        "تم فك الربط."
    )

    await callback.message.answer(
        "🔓 تم فك ربط WhatsApp.\n\n"
        "تم حذف رقم الهاتف من قاعدة بيانات الربط.",
        reply_markup=main_keyboard()
    )


# =========================================================
# STATUS
# =========================================================

@dp.callback_query(F.data == "status")
async def status_callback(callback):

    user_id = callback.from_user.id
    row = get_user(user_id)

    if not row or not row[1]:
        status = "🔴 غير مربوط"
    else:
        phone = row[0]

        if phone:
            masked = (
                phone[:3] +
                "****" +
                phone[-3:]
                if len(phone) > 7
                else "********"
            )

            status = (
                "🟢 مربوط\n"
                f"📱 الرقم: {masked}"
            )
        else:
            status = "🟡 في انتظار إتمام الربط"

    await callback.answer()

    await callback.message.answer(
        f"📊 الحالة:\n\n{status}",
        reply_markup=main_keyboard()
    )


# =========================================================
# GROUP AUTO REPLY
# =========================================================

@dp.message(
    F.chat.type.in_({"group", "supergroup"}),
    F.text
)
async def group_messages(message: Message):

    text = message.text.lower()

    bot_info = await bot.get_me()

    mentioned = False

    if bot_info.username:
        mentioned = (
            f"@{bot_info.username.lower()}"
            in text
        )

    if "فينك" in text or mentioned:

        await message.reply(
            "أنا مشغول دابا، البوت كيجاوب فبلاصتي 🤖"
        )


# =========================================================
# PRIVATE AUTO REPLY
# =========================================================

@dp.message(F.chat.type == "private", F.text)
async def private_messages(message: Message):

    text = message.text.lower().strip()

    greetings = {
        "سلام",
        "salam",
        "hello",
        "hi",
        "hey",
        "+"
    }

    if text in greetings:

        await message.answer(
            "وعليكم السلام 👋\n\n"
            "أنا مشغول دابا، البوت كيجاوب فبلاصتي 🤖"
        )


# =========================================================
# MAIN
# =========================================================

async def main():

    if not BOT_TOKEN:
        raise RuntimeError(
            "BOT_TOKEN is missing"
        )

    logger.info("FIGO BOT STARTED")

    await dp.start_polling(bot)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
