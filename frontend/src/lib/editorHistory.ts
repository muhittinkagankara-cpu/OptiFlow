/**
 * Süreç editörünün geri al / yeniden yap geçmişi.
 *
 * Klasik üçlü yapı: geçmiş yığını, şimdiki durum, gelecek yığını. Saf
 * işlevlerle yazılması bilinçlidir — geçmiş yönetimi, React durumuna
 * karışmadan tek başına sınanabilir; bir kullanıcının yirmi adımlık düzenleme
 * dizisini geri alması, doğruluğu gözle kontrol edilemeyecek kadar çok durum
 * üretir.
 *
 * Anlık görüntü nedir
 * -------------------
 * Editörün doğruluk kaynağı canvas'tır (`nodes` + `edges`). Geçmiş bu ikisinin
 * kopyasını tutar; `SimulationConfig` değil. Sebebi: yerleşim de geri
 * alınabilir olmalıdır. Yalnızca model saklansaydı, bir kutuyu yanlışlıkla
 * taşıyan kullanıcı "geri al" dediğinde model geri gelir ama kutu yeni yerinde
 * kalırdı.
 *
 * Sınır
 * -----
 * Yığın `MAX_HISTORY` adımda kırpılır. Sınırsız bir geçmiş, yirmi istasyonluk
 * bir modelde her sürüklemede tam bir kopya biriktirerek belleği sessizce
 * şişirirdi.
 */

/** Saklanacak en fazla adım sayısı. */
export const MAX_HISTORY = 50;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** Boş bir geçmiş oluşturur. */
export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Yeni bir durumu geçmişe işler.
 *
 * `future` bilinçli olarak temizlenir: kullanıcı geri alıp sonra **farklı** bir
 * değişiklik yaptıysa, ileri alınacak eski dal artık geçerli değildir. Dal
 * korunsaydı "yeniden yap" kullanıcının hiç yazmadığı bir duruma götürürdü.
 */
export function push<T>(history: History<T>, next: T): History<T> {
  const past = [...history.past, history.present];
  return {
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/** Bir adım geri alır. Geçmiş boşsa durum değişmez. */
export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) {
    return history;
  }
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

/** Bir adım yeniden yapar. Gelecek boşsa durum değişmez. */
export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) {
    return history;
  }
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}
