package org.json;
import java.util.*;
public class JSONArray {
    protected final List<Object> list = new ArrayList<>();
    public int length() { return list.size(); }
    public JSONArray put(Object o) { list.add(o); return this; }
    public Object opt(int i) { return i >= 0 && i < list.size() ? list.get(i) : null; }
    public JSONArray optJSONArray(int i) { Object o = opt(i); return o instanceof JSONArray ? (JSONArray) o : null; }
    public JSONObject optJSONObject(int i) { Object o = opt(i); return o instanceof JSONObject ? (JSONObject) o : null; }
    public String optString(int i, String d) { Object o = opt(i); return o instanceof String ? (String) o : d; }
}
