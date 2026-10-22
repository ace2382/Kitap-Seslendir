package org.json;
import java.util.*;
public class JSONObject {
    protected final Map<String, Object> map = new LinkedHashMap<>();
    public JSONObject put(String k, Object v) { map.put(k, v); return this; }
    public Object opt(String k) { return map.get(k); }
    public String optString(String k, String d) { Object o = map.get(k); return o instanceof String ? (String) o : d; }
    public int optInt(String k, int d) { Object o = map.get(k); return o instanceof Number ? ((Number) o).intValue() : d; }
    public boolean has(String k) { return map.containsKey(k); }
}
