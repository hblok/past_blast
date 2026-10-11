// shim.h - host replay shim for decompiled 16-bit code (M6.2b). C++20 (g++; `requires` in the recorded-effect stubs), generated TU includes this once.
// The 1 MB `mem[]` keeps the original layout: DS offsets in the blind C are the same numbers on the host.
// Pointers inside structs are 16-bit near offsets (NP<T>), far code pointers are FARP; both sized as in the exe,
// so struct layouts (obj_t 0x4c, state_t 0x1e) match the capture byte for byte.
#pragma once
#include <stdint.h>
#include <string.h>
#include <stddef.h>
#include <type_traits>
typedef uint8_t u8; typedef int8_t s8; typedef uint16_t u16; typedef int16_t s16; typedef uint32_t u32; typedef int32_t s32;
typedef u16 ushort; typedef u8 undefined1; typedef u16 undefined2; typedef u32 undefined4; typedef s16 undefined; typedef u8 uchar; typedef u32 ulong;
#define uint u16   // Ghidra's 16-bit `uint`; glibc's typedef is shadowed from here on
// 16-bit `int`/`long` are rewritten by replay.py to s16/s32 (explicit width, no macro tricks); `long` here = 32 bit.

// calling-convention and segment keywords: neutralised
#define __cdecl16far
#define __cdecl16near
#define __cdecl
#define __stdcall
#define __far
#define __near
#define far
#define near
#define huge
#define interrupt
#define cdecl

#ifdef SHIM_IMPL
extern "C" { u8 mem[1 << 20]; u16 g_DS, g_SS, g_ES, g_BX; }
#else
extern "C" { extern u8 mem[1 << 20]; extern u16 g_DS, g_SS, g_ES, g_BX; }
#endif

#define DSMEM(off)        (mem + ((u32)g_DS << 4) + (u16)(off))
#define NEAR8(off)        (*(u8  *)DSMEM(off))
#define NEAR16(off)       (*(u16 *)DSMEM(off))
#define NEAR32(off)       (*(u32 *)DSMEM(off))
#define FARMEM(seg, off)  (mem + (((u32)(u16)(seg) << 4) + (u16)(off)) % (1u << 20))
#define FAR8(seg, off)    (*(u8  *)FARMEM(seg, off))
#define FAR16(seg, off)   (*(u16 *)FARMEM(seg, off))
#define FAR32(seg, off)   (*(u32 *)FARMEM(seg, off))
#define FP(seg, off)      ((void *)FARMEM(seg, off))   // far pointer -> host pointer
#define MK_FP(seg, off)   FP(seg, off)                 // Borland dos.h; data far pointers in function bodies are host pointers (replay.py)
#define STACK16(sp, k)    (*(u16 *)(mem + ((u32)g_SS << 4) + (u16)((sp) + (k))))

// callee that cannot run here: carries which function, replay.py reports `untestable: calls X`
struct Untestable { u16 seg, off; const char *name; };
struct Any { template <class T> operator T() const { return T(); } };
template <class T> struct NP;
template <class T> NP<T> NPat(u16 off);

// recorded-effect callee stub (replay.py, captures made with capture.py --callees): the host asks the runner (ctypes callback) to check the
// arguments against the next recorded call of this callee and to apply its recorded memory delta; returns the recorded DX:AX.
// The callback returns 0 on success, else the stub throws Untestable with the reason (no record left, argument mismatch).
typedef int (*effect_cb)(const char *name, int nwords, const u16 *words, u32 *ret);
#ifdef SHIM_IMPL
extern "C" { effect_cb g_effect = 0; }
#else
extern "C" { extern effect_cb g_effect; }
#endif
struct RetV { u32 v; template <class T> operator T() const {
  if constexpr (requires { typename T::target; }) return NPat<typename T::target>((u16)v);
  else if constexpr (__is_class(T)) return T();
  else return (T)v; } };
template <class T> void argwords(u16 *&w, const T &a) {
  if constexpr (__is_class(T)) { if constexpr (requires { a.off; }) *w++ = a.off; }
  else if constexpr (sizeof(T) == 4) { *w++ = (u16)(u32)a; *w++ = (u16)((u32)a >> 16); }
  else *w++ = (u16)a; }

// near pointer: 16-bit offset in DS, usable like T*
template <class T> struct NP {
  typedef T target;
  u16 off;
  NP() : off(0) {}
  NP(T *p) : off(p ? (u16)((u8 *)p - (mem + ((u32)g_DS << 4))) : 0) {}
  operator T *() const { return off ? (T *)(mem + ((u32)g_DS << 4) + off) : (T *)0; }
  T *operator->() const { return (T *)*this; }
};
template <class T> NP<T> NPat(u16 off) { NP<T> p; p.off = off; return p; }   // from a raw DS offset (NP(T*) takes host pointers)
// word for an untyped recorded-effect stub: a near pointer is its offset, anything else truncates
template <class T> u16 w16(NP<T> p) { return p.off; }
template <class T> u16 w16(T v) { return (u16)v; }
// far code pointer in a struct (seg:off, 4 bytes): calling it is an untestable callee
struct FARP {
  u16 off, seg;
  explicit operator bool() const { return off || seg; }
  template <class... A> Any operator()(A...) const { throw Untestable{seg, off, 0}; }
};
// Ghidra-style `*(int *)(expr)` on a DS offset (or on an already-host pointer)
template <class T, class U> T *DSP(U v) {
  if constexpr (__is_pointer(U)) return (T *)v; else return (T *)DSMEM((u16)v);
}

// long (32-bit) helpers with explicit widths, the semantics of the Borland runtime helpers LMUL/LDIV/LUDIV/LXLSH/LXURSH
static inline s32 LXMUL(s32 a, s32 b) { return (s32)((u32)a * (u32)b); }
static inline s32 LDIV(s32 a, s32 b) { return b ? a / b : 0; }
static inline s32 LMOD(s32 a, s32 b) { return b ? a % b : 0; }
static inline u32 LUDIV(u32 a, u32 b) { return b ? a / b : 0; }
static inline u32 LUMOD(u32 a, u32 b) { return b ? a % b : 0; }
static inline s32 LXLSH(s32 a, u8 n) { return n >= 32 ? 0 : (s32)((u32)a << n); }
static inline u32 LXURSH(u32 a, u8 n) { return n >= 32 ? 0 : a >> n; }
static inline s32 LXRSH(s32 a, u8 n) { return n >= 32 ? (a < 0 ? -1 : 0) : a >> n; }
