import unittest

from services.items import _favorites, _items, create_item, list_items, toggle_favorite


class ItemTests(unittest.TestCase):
    def setUp(self):
        _items.clear()
        _favorites.clear()

    def test_create_and_list(self):
        item = create_item('  线性代数教材  ', 20, 'alice')
        self.assertEqual(item['title'], '线性代数教材')
        self.assertEqual(list_items(), [item])

    def test_invalid_prices_and_title(self):
        for price in (-1, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                create_item('book', price, 'alice')
        with self.assertRaises(ValueError):
            create_item(' ', 20, 'alice')

    def test_favorites_are_scoped_to_user(self):
        item = create_item('book', 20, 'alice')
        self.assertTrue(toggle_favorite(item['id'], 'alice'))
        self.assertTrue(toggle_favorite(item['id'], 'bob'))
        self.assertFalse(toggle_favorite(item['id'], 'alice'))
        self.assertIn(('bob', item['id']), _favorites)

    def test_missing_item(self):
        with self.assertRaises(KeyError):
            toggle_favorite('missing', 'alice')


if __name__ == '__main__':
    unittest.main()
